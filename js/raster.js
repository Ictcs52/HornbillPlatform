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

async function parseGeoTiffFile(file) {
  const buf = await file.arrayBuffer();
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
    fileName: file.name,
    sizeMB: file.size / (1024 * 1024),
    width, height, bbox,
    resX: Math.abs(resX), resY: Math.abs(resY),
    epsg, nodata,
    min: isFinite(min) ? min : null,
    max: isFinite(max) ? max : null,
    band
  };
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
