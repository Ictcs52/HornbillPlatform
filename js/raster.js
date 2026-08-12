// Client-side GeoTIFF handling for the Environmental Layers panel.
// Everything here runs in the browser (via vendor/geotiff) — no server, no
// upload anywhere; files never leave the visitor's machine.
const RASTER_SIZE_WARNING_MB = 50;

const EPSG_NAMES = {
  4326: 'WGS84',
  32647: 'UTM Zone 47N',
  32648: 'UTM Zone 48N'
};

function epsgLabel(epsg) {
  if (!epsg) return 'Unknown CRS';
  return EPSG_NAMES[epsg] ? EPSG_NAMES[epsg] + ' (EPSG:' + epsg + ')' : 'EPSG:' + epsg;
}

// Picks the best-matching layer for an uploaded filename by keyword overlap;
// the longest matching keyword wins (more specific match).
function guessLayerForFilename(filename, layers) {
  const n = filename.toLowerCase();
  let best = null, bestScore = 0;
  layers.forEach(l => {
    (l.keywords || [l.id]).forEach(k => {
      if (n.includes(k.toLowerCase()) && k.length > bestScore) {
        bestScore = k.length;
        best = l;
      }
    });
  });
  return best;
}

async function parseGeoTiffArrayBuffer(buf, fileName, sizeBytes) {
  const tiff = await GeoTIFF.fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox(); // [west, south, east, north]
  const [resX, resY] = image.getResolution();
  const geoKeys = image.getGeoKeys() || {};
  const epsg = geoKeys.ProjectedCSTypeGeoKey && geoKeys.ProjectedCSTypeGeoKey !== 4326
    ? geoKeys.ProjectedCSTypeGeoKey
    : (geoKeys.GeographicTypeGeoKey || null);

  let nodata = image.getFileDirectory().GDAL_NODATA;
  if (typeof nodata === 'string') {
    nodata = parseFloat(nodata.replace(/\0/g, '').trim());
  }
  if (typeof nodata !== 'number' || isNaN(nodata)) nodata = null;

  const rasters = await image.readRasters();
  const band = rasters[0];
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    if (nodata !== null && v === nodata) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return {
    fileName,
    sizeMB: sizeBytes / (1024 * 1024),
    width, height, bbox,
    resX: Math.abs(resX), resY: Math.abs(resY),
    epsg, nodata,
    min: isFinite(min) ? min : null,
    max: isFinite(max) ? max : null,
    band
  };
}

async function parseGeoTiffFile(file) {
  const buf = await file.arrayBuffer();
  return parseGeoTiffArrayBuffer(buf, file.name, file.size);
}

async function fetchGeoTiff(url, displayName) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to fetch ' + url);
  const buf = await resp.arrayBuffer();
  return parseGeoTiffArrayBuffer(buf, displayName, buf.byteLength);
}

// Nearest-cell lookup — null if the point falls outside the raster or on a nodata cell.
function sampleRasterAt(raster, lat, lon) {
  const [west, south, east, north] = raster.bbox;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const col = Math.min(raster.width - 1, Math.floor((lon - west) / (east - west) * raster.width));
  const row = Math.min(raster.height - 1, Math.floor((north - lat) / (north - south) * raster.height));
  const v = raster.band[row * raster.width + col];
  if (raster.nodata !== null && v === raster.nodata) return null;
  return v;
}

function countPointsOutsideRaster(raster, points) {
  const [west, south, east, north] = raster.bbox;
  let count = 0;
  points.forEach(([lat, lon]) => {
    if (lon < west || lon > east || lat < south || lat > north) count++;
  });
  return count;
}

// Shared grid used when interpolating uploaded station point data into a
// raster, matching the extent/resolution of the bundled TMD rasters so a
// user-supplied layer lines up with them.
const STATION_GRID = { bbox: [97, 5.5, 105.5, 21.0], width: 340, height: 620 };

// Parses a TMD Climate Atlas / qgis2web station export: a JS file of the
// form `var json_<name> = { ...GeoJSON FeatureCollection... };` (bare
// GeoJSON also works). Each feature needs Latitude/Longitude properties
// plus exactly one more property holding the measured value — its key
// varies by variable ("Rainfall (mm.)", "Temperature (Celsius)", a PM2.5
// column, etc.) so it's auto-detected as whichever property isn't
// Station/Station ID/Latitude/Longitude.
function parseStationText(text) {
  const match = String(text).match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
  const jsonText = match ? match[1] : text;
  let geo;
  try {
    geo = JSON.parse(jsonText);
  } catch (err) {
    return { stations: [], errorCount: 0, valueLabel: null, parseError: err.message };
  }
  const skipKeys = new Set(['Station', 'Station ID', 'Latitude', 'Longitude']);
  const stations = [];
  let errorCount = 0;
  let valueLabel = null;
  (geo.features || []).forEach(f => {
    const props = (f && f.properties) || {};
    const lat = parseFloat(props.Latitude);
    const lon = parseFloat(props.Longitude);
    const valueKey = Object.keys(props).find(k => !skipKeys.has(k));
    const value = valueKey ? parseFloat(props[valueKey]) : NaN;
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(value)) { errorCount++; return; }
    if (!valueLabel) valueLabel = valueKey;
    stations.push({ lat, lon, value, name: props.Station || '' });
  });
  return { stations, errorCount, valueLabel, parseError: null };
}

// Inverse-distance-weighted interpolation (power 2) from station points to
// the shared STATION_GRID — the same method used offline to build the
// bundled TMD rasters, run client-side so uploaded station data works the
// same way. Returns an object shaped like the parsed-GeoTIFF rasters so it
// can drop straight into the existing rendering/sampling pipeline.
function idwToRaster(stations, fileName) {
  const { bbox, width, height } = STATION_GRID;
  const [west, south, east, north] = bbox;
  const band = new Float32Array(width * height);
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < height; row++) {
    const lat = north - (row + 0.5) / height * (north - south);
    for (let col = 0; col < width; col++) {
      const lon = west + (col + 0.5) / width * (east - west);
      let weightSum = 0, valueSum = 0, exact = null;
      for (let i = 0; i < stations.length; i++) {
        const s = stations[i];
        const dLat = lat - s.lat, dLon = lon - s.lon;
        const distSq = dLat * dLat + dLon * dLon;
        if (distSq < 1e-10) { exact = s.value; break; }
        const w = 1 / distSq;
        weightSum += w;
        valueSum += w * s.value;
      }
      const v = exact !== null ? exact : valueSum / weightSum;
      band[row * width + col] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return {
    fileName, sizeMB: 0,
    width, height, bbox,
    resX: (east - west) / width, resY: (north - south) / height,
    epsg: 4326, nodata: null,
    min, max, band
  };
}

// Color ramps for rendering raster layers as a heatmap image, styled after
// the TMD Climate Atlas legends (cool-to-hot for temperature, pale-to-purple
// for rainfall). Each stop is {t: 0-1, r, g, b}.
const TEMP_RAMP = [
  { t: 0, r: 0x2e, g: 0x1a, b: 0x6b },
  { t: 0.15, r: 0x2b, g: 0x4b, b: 0xc4 },
  { t: 0.30, r: 0x22, g: 0x9e, b: 0xd6 },
  { t: 0.45, r: 0x2e, g: 0xc4, b: 0x8a },
  { t: 0.58, r: 0x8b, g: 0xc3, b: 0x4a },
  { t: 0.70, r: 0xf9, g: 0xd4, b: 0x23 },
  { t: 0.80, r: 0xf4, g: 0x8c, b: 0x1f },
  { t: 0.90, r: 0xd8, g: 0x43, b: 0x15 },
  { t: 1, r: 0x7a, g: 0x0a, b: 0x0a }
];

const RAINFALL_RAMP = [
  { t: 0, r: 0xff, g: 0xff, b: 0xff },
  { t: 0.05, r: 0xfd, g: 0xf8, b: 0xc9 },
  { t: 0.15, r: 0xf0, g: 0xf1, b: 0x8a },
  { t: 0.30, r: 0xc8, g: 0xe4, b: 0x6a },
  { t: 0.45, r: 0x6d, g: 0xc3, b: 0x50 },
  { t: 0.55, r: 0x2f, g: 0x9e, b: 0x55 },
  { t: 0.65, r: 0x1a, g: 0x8a, b: 0x7a },
  { t: 0.75, r: 0x20, g: 0x70, b: 0xb8 },
  { t: 0.85, r: 0x5a, g: 0x4f, b: 0xc4 },
  { t: 0.93, r: 0x7a, g: 0x2f, b: 0xb0 },
  { t: 1, r: 0x4a, g: 0x0f, b: 0x52 }
];

// Pale (bare/cleared land, 0%) to deep forest green (dense canopy, 100%).
const FOREST_RAMP = [
  { t: 0, r: 0xf5, g: 0xf1, b: 0xe0 },
  { t: 0.15, r: 0xe3, g: 0xe8, b: 0xb8 },
  { t: 0.35, r: 0xb8, g: 0xd4, b: 0x7a },
  { t: 0.55, r: 0x7a, g: 0xb8, b: 0x4a },
  { t: 0.75, r: 0x3f, g: 0x8f, b: 0x3a },
  { t: 1, r: 0x14, g: 0x4d, b: 0x1f }
];

const RASTER_RAMPS = { rainfall: RAINFALL_RAMP, temperature: TEMP_RAMP, forest: FOREST_RAMP };

// Fixed classification breaks for the map legend and raster coloring, styled
// after the TMD Climate Atlas legend (rainfall breaks match it exactly; the
// full 1degC-step scale for temperature). `breaks` drives the actual pixel
// classification (fine steps make the raster shading look smooth);
// `legendBreaks`, when present, is a coarser subset used only to keep the
// on-map legend list a reasonable height — each shown row still gets its
// color from the same classification as the raster, just at that value.
const RASTER_CLASSES = {
  rainfall: { unit: 'mm.', breaks: [0, 0.1, 5, 10, 20, 35, 60, 90, 120, 150, 200, 300, 400, 600, 800, 1000, 1400, 1800, 2400, 3000, 4000] },
  temperature: {
    unit: '°C',
    breaks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44],
    legendBreaks: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 44]
  },
  forest: { unit: '%', breaks: [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] }
};

// Classifies a value into one of `breaks.length - 1` bands (clamped at the
// ends) and returns its rank position 0-1, so every band is evenly spaced
// through the ramp regardless of how wide its value range is — matching a
// classed/graduated legend rather than a smooth continuous gradient.
function classifyRank(breaks, value) {
  const lastBand = breaks.length - 2;
  if (value <= breaks[0]) return 0;
  if (value >= breaks[breaks.length - 1]) return lastBand;
  for (let i = 1; i < breaks.length; i++) {
    if (value < breaks[i]) return (i - 1) / lastBand;
  }
  return 1;
}

function classColor(ramp, breaks, value) {
  return rampColor(ramp, classifyRank(breaks, value));
}

function rampColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1], b = stops[i];
      const f = (t - a.t) / ((b.t - a.t) || 1);
      return [
        Math.round(a.r + f * (b.r - a.r)),
        Math.round(a.g + f * (b.g - a.g)),
        Math.round(a.b + f * (b.b - a.b))
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

// Rasterizes a parsed GeoTIFF band into a colored PNG data URL for use as a
// Leaflet image overlay — entirely client-side, no server round trip.
// `boundary` is an optional GeoJSON Polygon/MultiPolygon geometry; pixels
// falling outside it are made transparent, so the raster is clipped to a
// real coastline instead of showing the full rectangular grid extent.
// `breaks`, if given, classifies each pixel into a fixed set of bands (see
// RASTER_CLASSES) instead of stretching colors across the raster's own
// min/max — a classed/graduated look matching the reference legend, with
// colors that stay comparable across different rasters.
function renderRasterToDataUrl(raster, ramp, boundary, breaks) {
  const { width, height, band, min, max, nodata, bbox } = raster;
  const [west, south, east, north] = bbox;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const range = (max - min) || 1;
  for (let row = 0; row < height; row++) {
    const lat = north - (row + 0.5) / height * (north - south);
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const o = i * 4;
      const v = band[i];
      if (nodata !== null && v === nodata) {
        imgData.data[o + 3] = 0;
        continue;
      }
      if (boundary) {
        const lon = west + (col + 0.5) / width * (east - west);
        if (!pointInGeoJSON(lat, lon, boundary)) {
          imgData.data[o + 3] = 0;
          continue;
        }
      }
      const [r, g, b] = breaks ? classColor(ramp, breaks, v) : rampColor(ramp, (v - min) / range);
      imgData.data[o] = r;
      imgData.data[o + 1] = g;
      imgData.data[o + 2] = b;
      imgData.data[o + 3] = 220;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}

// Cached per-ring bounding box, so a multi-part boundary (e.g. many small
// islands) can reject a point cheaply before running the full ray-cast.
const ringBboxCache = new WeakMap();
function ringBbox(ring) {
  let box = ringBboxCache.get(ring);
  if (box) return box;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const lon = ring[i][0], lat = ring[i][1];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  box = [minLon, minLat, maxLon, maxLat];
  ringBboxCache.set(ring, box);
  return box;
}

// Ray-casting point-in-polygon test. `ring` is a GeoJSON linear ring: [[lon,lat], ...].
function pointInRing(lat, lon, ring) {
  const [minLon, minLat, maxLon, maxLat] = ringBbox(ring);
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeoJSON(lat, lon, geometry) {
  if (!geometry) return true;
  if (geometry.type === 'Polygon') return pointInRing(lat, lon, geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(poly => pointInRing(lat, lon, poly[0]));
  return true;
}
