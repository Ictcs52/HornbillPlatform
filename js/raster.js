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

// Color ramps for rendering raster layers as a heatmap image, styled after
// the TMD Climate Atlas legends (cool-to-hot for temperature, pale-to-purple
// for rainfall). Each stop is {t: 0-1, r, g, b}.
const TEMP_RAMP = [
  { t: 0, r: 0x2c, g: 0x7f, b: 0xb8 },
  { t: 0.25, r: 0x7f, g: 0xc9, b: 0x7f },
  { t: 0.5, r: 0xd9, g: 0xd9, b: 0x4f },
  { t: 0.75, r: 0xe8, g: 0x8a, b: 0x2a },
  { t: 1, r: 0xb5, g: 0x1f, b: 0x1f }
];

const RAINFALL_RAMP = [
  { t: 0, r: 0xf5, g: 0xf0, b: 0xd9 },
  { t: 0.3, r: 0xb8, g: 0xd9, b: 0x6a },
  { t: 0.55, r: 0x4f, g: 0xa8, b: 0x8a },
  { t: 0.75, r: 0x2f, g: 0x6f, b: 0xb8 },
  { t: 1, r: 0x6b, g: 0x2f, b: 0xb8 }
];

const RASTER_RAMPS = { rainfall: RAINFALL_RAMP, temperature: TEMP_RAMP };

// Fixed classification breaks for the map legend and raster coloring, styled
// after the TMD Climate Atlas legend (rainfall breaks match it exactly).
// Using a fixed domain instead of each raster's own min/max keeps colors
// comparable across datasets and matches the classed look of the source.
const RASTER_CLASSES = {
  rainfall: { unit: 'mm.', breaks: [0, 0.1, 5, 10, 20, 35, 60, 90, 120, 150, 200, 300, 400, 600, 800, 1000, 1400, 1800, 2400, 3000, 4000] },
  temperature: { unit: '°C', breaks: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32] }
};

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
// `domain`, if given, is a fixed [min, max] used instead of the raster's own
// min/max, so colors line up with a fixed classed legend (see RASTER_CLASSES)
// rather than being re-stretched to whatever this particular file contains.
function renderRasterToDataUrl(raster, ramp, boundary, domain) {
  const { width, height, band, nodata, bbox } = raster;
  const [domMin, domMax] = domain || [raster.min, raster.max];
  const [west, south, east, north] = bbox;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const range = (domMax - domMin) || 1;
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
      const [r, g, b] = rampColor(ramp, (v - domMin) / range);
      imgData.data[o] = r;
      imgData.data[o + 1] = g;
      imgData.data[o + 2] = b;
      imgData.data[o + 3] = 220;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}

// Ray-casting point-in-polygon test. `ring` is a GeoJSON linear ring: [[lon,lat], ...].
function pointInRing(lat, lon, ring) {
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
