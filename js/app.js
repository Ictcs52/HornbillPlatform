(function () {
  'use strict';

  const state = {
    lang: 'en',
    mapTab: 'distribution',
    forestRiskTab: 'rainfall',
    speciesSel: { great: true, wreathed: true, rufous: true, rhino: true, helmeted: true },
    layers: ENV_LAYERS.map(l => ({ ...l })),
    settings: {
      targetYear: 2025,
      // Each target year keeps its own temp/rainfall/dust deltas, entered
      // and stored independently — switching years recalls that year's
      // values instead of sharing one set across all of them.
      deltasByYear: {
        2025: { tempDelta: 0, rainfallDelta: 0, dustDelta: 0 },
        2030: { tempDelta: 0, rainfallDelta: 0, dustDelta: 0 },
        2050: { tempDelta: 0, rainfallDelta: 0, dustDelta: 0 },
        2070: { tempDelta: 0, rainfallDelta: 0, dustDelta: 0 }
      }
    },
    dataValidated: true, // bundled sample data is loaded and considered validated by default
    running: false,
    runProgress: 0,
    modelRun: false,
    fittedModel: null,
    log: [],
    uploads: [],
    dataSource: 'sample', // 'sample' | 'upload'
    uploadedRows: [],
    uploadedSpecies: null,
    unmatchedRasterFiles: [],
    leftCollapsed: false,
    rightCollapsed: false,
    collapsedSections: { samples: false, envLayers: false, climate: false },
    provinceBoundaries: null,
    thailandOutline: null
  };

  let runTimer = null;

  const UPLOAD_PALETTE = ['#1f9e4a', '#d9a319', '#e8552a', '#1f9bd9', '#bb32c4', '#4f7942', '#a85a34', '#3d6a8a', '#8a7c3f', '#b5652f'];

  function matchKnownSpecies(name) {
    const n = name.trim().toLowerCase();
    return SPECIES.find(sp => sp.id.toLowerCase() === n || sp.common.toLowerCase() === n
      || (sp.latin && sp.latin.toLowerCase() === n) || sp.thai === name.trim());
  }

  const SPECIES_COLS = ['species', 'name', 'scientificname', 'verbatimscientificname'];
  const LON_COLS = ['lon', 'lng', 'longitude', 'decimallongitude'];
  const LAT_COLS = ['lat', 'latitude', 'decimallatitude'];

  // Parses occurrence text into {species, lon, lat} rows. Supports plain
  // "species,lon,lat" CSV as well as GBIF occurrence downloads, whose "CSV"
  // export is actually tab-delimited Darwin Core (columns like species,
  // decimalLatitude, decimalLongitude among many others).
  function parseCsvText(text) {
    const lines = String(text || '').split(/\r\n|\n|\r/).map(l => l.replace(/\r$/, '')).filter(l => l.trim().length);
    if (!lines.length) return { rows: [], errorCount: 0 };

    const commaCount = (lines[0].match(/,/g) || []).length;
    const tabCount = (lines[0].match(/\t/g) || []).length;
    const delim = tabCount > commaCount ? '\t' : ',';
    const split = line => line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''));

    let startIdx = 0;
    let idx = { species: 0, lon: 1, lat: 2 };
    const headerCells = split(lines[0]).map(c => c.toLowerCase());
    const looksLikeHeader = headerCells.some(c => SPECIES_COLS.includes(c) || LON_COLS.includes(c) || LAT_COLS.includes(c));
    if (looksLikeHeader) {
      startIdx = 1;
      const idxOf = names => headerCells.findIndex(c => names.includes(c));
      const sIdx = idxOf(SPECIES_COLS);
      const loIdx = idxOf(LON_COLS);
      const laIdx = idxOf(LAT_COLS);
      if (sIdx >= 0) idx.species = sIdx;
      if (loIdx >= 0) idx.lon = loIdx;
      if (laIdx >= 0) idx.lat = laIdx;
    }

    const rows = [];
    let errorCount = 0;
    for (let i = startIdx; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = split(lines[i]);
      const species = cells[idx.species];
      const lon = parseFloat(cells[idx.lon]);
      const lat = parseFloat(cells[idx.lat]);
      if (!species || !isFinite(lon) || !isFinite(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        errorCount++;
        continue;
      }
      rows.push({ species, lon, lat });
    }
    return { rows, errorCount };
  }

  function buildUploadedSpecies(rows) {
    const groups = new Map();
    rows.forEach(r => {
      const known = matchKnownSpecies(r.species);
      const key = known ? known.id : 'custom_' + r.species.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          common: known ? known.common : r.species.trim(),
          thai: known ? known.thai : r.species.trim(),
          color: known ? known.color : UPLOAD_PALETTE[groups.size % UPLOAD_PALETTE.length],
          points: []
        });
      }
      groups.get(key).points.push([r.lat, r.lon]);
    });
    // Order matches the canonical SPECIES list (not upload row order, which
    // varies by file and would otherwise reshuffle the list/colors on every
    // upload); unmatched/custom species are appended after, in the order
    // they first appeared.
    const canonicalOrder = SPECIES.map(sp => sp.id);
    const ordered = Array.from(groups.values()).sort((a, b) => {
      const ia = canonicalOrder.indexOf(a.id);
      const ib = canonicalOrder.indexOf(b.id);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return ordered.map(g => ({ ...g, total: g.points.length }));
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function updateSetting(key, val) { state.settings[key] = val; render(); }

  // The climate-scenario numeric boxes show the absolute value the user is
  // projecting to (defaulting to the current real/observed value), not the
  // delta itself — this converts what was typed back into a delta against
  // the current optimal value for storage.
  const CURVE_ID_BY_DELTA_FIELD = { tempDelta: 'temp', rainfallDelta: 'rainfall', dustDelta: 'dust' };
  function setClimateAbsolute(field, value) {
    const curveId = CURVE_ID_BY_DELTA_FIELD[field];
    const curve = computeVals().responseCurves.find(c => c.id === curveId);
    state.settings.deltasByYear[state.settings.targetYear][field] = Number(value) - curve.optimalValue;
    render();
  }
  function setLang(l) { state.lang = l; render(); }
  function setForestRiskTab(tab) { state.forestRiskTab = tab; render(); }
  function toggleSpecies(id) { state.speciesSel[id] = !state.speciesSel[id]; render(); }
  function validateData() { state.dataValidated = true; render(); }
  function useSampleData() {
    state.dataSource = 'sample';
    state.uploadedRows = [];
    state.uploadedSpecies = null;
    state.speciesSel = { great: true, wreathed: true, rufous: true, rhino: true, helmeted: true };
    state.dataValidated = true;
    render();
  }

  function onFileUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const entries = files.map(f => ({ name: f.name, sizeKB: Math.max(1, Math.round(f.size / 1024)), status: 'processing' }));
    state.uploads = [...state.uploads, ...entries];
    render();

    files.forEach((file, i) => {
      const entryName = entries[i].name;
      const reader = new FileReader();
      reader.onload = () => {
        const { rows, errorCount } = parseCsvText(reader.result);
        if (rows.length) {
          state.uploadedRows = [...state.uploadedRows, ...rows];
          state.uploadedSpecies = buildUploadedSpecies(state.uploadedRows);
          state.speciesSel = Object.fromEntries(state.uploadedSpecies.map(sp => [sp.id, true]));
          state.dataSource = 'upload';
          state.dataValidated = false;
        }
        state.uploads = state.uploads.map(u => u.name === entryName
          ? { ...u, status: rows.length ? 'ready' : 'error', pointCount: rows.length, errorCount }
          : u);
        render();
      };
      reader.onerror = () => {
        state.uploads = state.uploads.map(u => u.name === entryName ? { ...u, status: 'error' } : u);
        render();
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  }
  function toggleLeftPanel() { state.leftCollapsed = !state.leftCollapsed; render(); }
  function toggleSection(id) { state.collapsedSections[id] = !state.collapsedSections[id]; render(); }
  function setMapTab(tab) { state.mapTab = tab; render(); }
  function toggleRightPanel() { state.rightCollapsed = !state.rightCollapsed; render(); }
  function updateLayerField(id, field, value) {
    state.layers = state.layers.map(l => l.id === id ? { ...l, [field]: value } : l);
    render();
  }
  function removeLayer(id) { state.layers = state.layers.filter(l => l.id !== id); render(); }
  function removeRasterFromLayer(id) {
    state.layers = state.layers.map(l => l.id === id ? { ...l, status: 'not_loaded', raster: null, fileName: null, sizeMB: null, error: null } : l);
    render();
  }

  // --- Environmental layer raster uploads (GeoTIFF, parsed entirely client-side) ---
  // Rasterizes the loaded band into a colored PNG (see raster.js) for layers
  // that have a defined color ramp, so it can be shown as a map overlay.
  function attachRasterImage(raster, layerId) {
    const ramp = RASTER_RAMPS[layerId];
    const classes = RASTER_CLASSES[layerId];
    if (ramp) {
      raster.imgUrl = renderRasterToDataUrl(raster, ramp, state.thailandOutline || THAILAND_BOUNDARY, classes ? classes.breaks : null);
    }
    return raster;
  }

  function assignRasterToLayer(layerId, file) {
    state.layers = state.layers.map(l => l.id === layerId
      ? { ...l, status: 'processing', raster: null, fileName: file.name, sizeMB: file.size / (1024 * 1024), error: null }
      : l);
    render();
    parseGeoTiffFile(file).then(raster => {
      attachRasterImage(raster, layerId);
      state.layers = state.layers.map(l => l.id === layerId ? { ...l, status: 'ready', raster } : l);
      render();
    }).catch(err => {
      state.layers = state.layers.map(l => l.id === layerId ? { ...l, status: 'error', raster: null, error: err.message } : l);
      render();
    });
  }

  function handleRasterFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => /\.tiff?$/i.test(f.name));
    files.forEach(file => {
      const guessed = guessLayerForFilename(file.name, state.layers);
      if (guessed) {
        assignRasterToLayer(guessed.id, file);
        return;
      }
      const tempId = 'unmatched_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      state.unmatchedRasterFiles = [...state.unmatchedRasterFiles, { tempId, fileName: file.name, sizeMB: file.size / (1024 * 1024), status: 'processing', raster: null }];
      render();
      parseGeoTiffFile(file).then(raster => {
        state.unmatchedRasterFiles = state.unmatchedRasterFiles.map(u => u.tempId === tempId ? { ...u, status: 'ready', raster } : u);
        render();
      }).catch(err => {
        state.unmatchedRasterFiles = state.unmatchedRasterFiles.map(u => u.tempId === tempId ? { ...u, status: 'error', error: err.message } : u);
        render();
      });
    });
  }

  function assignUnmatchedToLayer(tempId, layerId) {
    if (!layerId) return;
    const entry = state.unmatchedRasterFiles.find(u => u.tempId === tempId);
    if (!entry || !entry.raster) return;
    attachRasterImage(entry.raster, layerId);
    state.unmatchedRasterFiles = state.unmatchedRasterFiles.filter(u => u.tempId !== tempId);
    state.layers = state.layers.map(l => l.id === layerId
      ? { ...l, status: 'ready', raster: entry.raster, fileName: entry.fileName, sizeMB: entry.sizeMB, error: null }
      : l);
    render();
  }

  function dismissUnmatchedFile(tempId) {
    state.unmatchedRasterFiles = state.unmatchedRasterFiles.filter(u => u.tempId !== tempId);
    render();
  }

  // --- Station-point data upload (TMD-style .js/.txt export), interpolated
  // client-side into a raster via IDW — an alternative to uploading a
  // ready-made .tif, for layers that only have raw station data available.
  function uploadStationData(layerId, file) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseStationText(reader.result);
      state.layers = state.layers.map(l => l.id === layerId
        ? { ...l, stationPending: { ...parsed, fileName: file.name } }
        : l);
      render();
    };
    reader.onerror = () => {
      state.layers = state.layers.map(l => l.id === layerId
        ? { ...l, stationPending: { stations: [], errorCount: 0, valueLabel: null, parseError: 'Failed to read file', fileName: file.name } }
        : l);
      render();
    };
    reader.readAsText(file);
  }

  function validateStationData(layerId) {
    const layer = state.layers.find(l => l.id === layerId);
    const pending = layer && layer.stationPending;
    if (!pending || !pending.stations.length) return;
    const raster = idwToRaster(pending.stations, pending.fileName);
    attachRasterImage(raster, layerId);
    state.layers = state.layers.map(l => l.id === layerId
      ? {
          ...l, status: 'ready', raster, fileName: pending.fileName, sizeMB: null, error: null,
          stationPending: null, stationMeta: { count: pending.stations.length, errorCount: pending.errorCount, valueLabel: pending.valueLabel }
        }
      : l);
    render();
  }

  function useSampleRaster(layerId) {
    const def = DEFAULT_RASTERS.find(d => d.layerId === layerId);
    if (!def) return;
    state.layers = state.layers.map(l => l.id === layerId ? { ...l, status: 'processing', stationPending: null } : l);
    render();
    fetchGeoTiff(def.url, def.name).then(raster => {
      attachRasterImage(raster, layerId);
      state.layers = state.layers.map(l => l.id === layerId
        ? { ...l, status: 'ready', raster, fileName: def.name, sizeMB: raster.sizeMB, stationMeta: null }
        : l);
      render();
    }).catch(err => {
      state.layers = state.layers.map(l => l.id === layerId ? { ...l, status: 'not_loaded' } : l);
      console.error(err);
      render();
    });
  }

  function addLayer() {
    const id = 'custom' + Date.now();
    state.layers = [...state.layers, { id, name: 'New Variable', group: 'Climate', resolution: '1km', source: 'Custom', status: 'not_loaded' }];
    render();
  }

  function runModel() {
    if (state.running) return;
    state.running = true;
    state.runProgress = 0;
    state.log = [];
    state.modelRun = false;
    render();
    // Deferred so the "Running…" state paints before the (synchronous, but
    // sub-second) model fit blocks the main thread.
    setTimeout(() => {
      const presencePoints = getAllOccurrencePoints();
      const usableVars = ['temp', 'rainfall', 'dust'].filter(id => {
        const layer = state.layers.find(l => l.id === LAYER_ID_BY_CURVE_ID[id]);
        return layer && layer.raster;
      });
      state.fittedModel = fitHabitatModel(presencePoints, usableVars);
      const steps = buildRunLogLines(state.fittedModel);
      let i = 0;
      const tick = () => {
        i++;
        state.log = [...state.log, steps[i - 1]];
        state.runProgress = Math.round((i / steps.length) * 100);
        if (i < steps.length) {
          runTimer = setTimeout(tick, 420);
        } else {
          state.running = false;
          state.modelRun = true;
        }
        render();
      };
      runTimer = setTimeout(tick, 300);
    }, 30);
  }

  const ACTIONS = {
    setLang, setMapTab, setForestRiskTab, toggleSpecies, validateData, useSampleData,
    removeLayer, removeRasterFromLayer,
    validateStationData, useSampleRaster,
    addLayer, runModel, toggleMapFullscreen,
    dismissUnmatchedFile, toggleLeftPanel, toggleRightPanel, toggleSection
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    const id = el.getAttribute('data-id');
    if (ACTIONS[action]) ACTIONS[action](id);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    const onchange = el.getAttribute('data-onchange');
    if (!onchange) return;
    if (onchange === 'layerField') {
      updateLayerField(el.getAttribute('data-id'), el.getAttribute('data-field'), el.value);
    } else if (onchange === 'layerResolution') {
      const row = el.closest('.layer-row');
      const resNum = row.querySelector('.res-num').value;
      const resUnit = row.querySelector('.res-unit').value;
      updateLayerField(el.getAttribute('data-id'), 'resolution', resNum + resUnit);
    } else if (onchange === 'setting') {
      const field = el.getAttribute('data-field');
      const numeric = el.getAttribute('data-numeric') === 'true';
      updateSetting(field, numeric ? Number(el.value) : el.value);
    } else if (onchange === 'climateAbsolute') {
      setClimateAbsolute(el.getAttribute('data-field'), el.value);
    } else if (onchange === 'fileUpload') {
      onFileUpload(e);
    } else if (onchange === 'rasterUpload') {
      handleRasterFiles(el.files);
      el.value = '';
    } else if (onchange === 'stationUpload') {
      const file = el.files && el.files[0];
      if (file) uploadStationData(el.getAttribute('data-id'), file);
      el.value = '';
    } else if (onchange === 'assignUnmatchedRaster') {
      assignUnmatchedToLayer(el.getAttribute('data-temp-id'), el.value);
    }
  });

  document.addEventListener('dragover', (e) => {
    if (e.target.closest('#rasterDropzone')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const zone = e.target.closest('#rasterDropzone');
    if (!zone) return;
    e.preventDefault();
    handleRasterFiles(e.dataTransfer.files);
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.type !== 'range') return;
    const onchange = el.getAttribute('data-onchange');
    if (onchange === 'setting') {
      updateSetting(el.getAttribute('data-field'), Number(el.value));
    }
  });

  // --- Real habitat-suitability model, fit at Run time from the currently
  // loaded data (presence points vs. sampled background) instead of reading
  // canned response-curve/importance constants. Presence = occurrence points
  // of the active species set; background = random points inside the
  // Thailand outline, both sampled against whichever of temp/rainfall/dust
  // are actually loaded. Logistic regression (L2, gradient descent) gives a
  // real Mean HSI, real partial-dependence response curves, real permutation
  // variable importance, and a real 5-fold cross-validated AUC.

  function getAllOccurrencePoints() {
    const usingUpload = state.dataSource === 'upload' && state.uploadedSpecies;
    const activeSpecies = usingUpload ? state.uploadedSpecies : SPECIES;
    return activeSpecies.flatMap(sp => sp.points);
  }

  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  function standardizeCol(values) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
    return { mean, std: Math.sqrt(variance) || 1 };
  }

  function zRow(stats, row) {
    return row.map((v, j) => (v - stats[j].mean) / stats[j].std);
  }

  // Batch gradient descent, L2-regularized binary logistic regression.
  function fitLogisticRegression(X, y, opts) {
    const nFeat = X[0].length;
    const n = X.length;
    const lr = (opts && opts.lr) || 0.3;
    const iters = (opts && opts.iters) || 300;
    const l2 = (opts && opts.l2) || 0.02;
    const weights = new Array(nFeat).fill(0);
    let bias = 0;
    for (let it = 0; it < iters; it++) {
      const gradW = new Array(nFeat).fill(0);
      let gradB = 0;
      for (let i = 0; i < n; i++) {
        const xi = X[i];
        let z = bias;
        for (let j = 0; j < nFeat; j++) z += weights[j] * xi[j];
        const err = sigmoid(z) - y[i];
        for (let j = 0; j < nFeat; j++) gradW[j] += err * xi[j];
        gradB += err;
      }
      for (let j = 0; j < nFeat; j++) weights[j] -= lr * (gradW[j] / n + l2 * weights[j]);
      bias -= lr * (gradB / n);
    }
    return { weights, bias };
  }

  function predictProb(model, row) {
    let z = model.bias;
    for (let j = 0; j < row.length; j++) z += model.weights[j] * row[j];
    return sigmoid(z);
  }

  // Mann-Whitney AUC: probability a random presence scores above a random
  // background point. Ties get the average rank.
  function computeAUC(scores, labels) {
    const n = scores.length;
    const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
    const ranks = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && scores[order[j]] === scores[order[i]]) j++;
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) ranks[order[k]] = avgRank;
      i = j;
    }
    let sumRanksPos = 0, nPos = 0, nNeg = 0;
    for (let k = 0; k < n; k++) {
      if (labels[k] === 1) { sumRanksPos += ranks[k]; nPos++; } else nNeg++;
    }
    if (!nPos || !nNeg) return null;
    return (sumRanksPos - nPos * (nPos + 1) / 2) / (nPos * nNeg);
  }

  function kFoldAUC(X, y, k, fitOpts) {
    const n = X.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[r]] = [idx[r], idx[i]];
    }
    const foldSize = Math.ceil(n / k);
    const aucs = [];
    for (let f = 0; f < k; f++) {
      const testSet = new Set(idx.slice(f * foldSize, (f + 1) * foldSize));
      const trainX = [], trainY = [], testX = [], testY = [];
      for (let i = 0; i < n; i++) {
        if (testSet.has(i)) { testX.push(X[i]); testY.push(y[i]); }
        else { trainX.push(X[i]); trainY.push(y[i]); }
      }
      if (!trainX.length || !testX.length) continue;
      const m = fitLogisticRegression(trainX, trainY, fitOpts);
      const auc = computeAUC(testX.map(row => predictProb(m, row)), testY);
      if (auc !== null) aucs.push(auc);
    }
    return aucs.length ? aucs.reduce((a, b) => a + b, 0) / aucs.length : null;
  }

  // Rounds importance shares to whole percentages while keeping them summing
  // to exactly 100 (largest-remainder method), so the UI never shows e.g. a
  // 33/34/32 split that visibly fails to add up.
  function roundSharesTo100(shares) {
    const floors = shares.map(Math.floor);
    let remainder = 100 - floors.reduce((a, b) => a + b, 0);
    const order = shares.map((v, i) => ({ i, frac: v - floors[i] })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < remainder && k < order.length; k++) floors[order[k].i]++;
    return floors;
  }

  const BACKGROUND_N = 3000;
  const FIT_OPTS = { lr: 0.3, iters: 180, l2: 0.02 };

  function fitHabitatModel(presencePoints, varIds) {
    if (!varIds.length) return null;
    const rasters = varIds.map(id => state.layers.find(l => l.id === LAYER_ID_BY_CURVE_ID[id]).raster);

    const presenceX = [];
    presencePoints.forEach(([lat, lon]) => {
      const row = rasters.map(r => sampleRasterAt(r, lat, lon));
      if (row.every(v => v !== null)) presenceX.push(row);
    });
    if (presenceX.length < 10) return null;

    const outline = state.thailandOutline || THAILAND_BOUNDARY;
    const bbox = rasters[0].bbox;
    const backgroundX = [];
    const maxAttempts = BACKGROUND_N * 40;
    let attempts = 0;
    while (backgroundX.length < BACKGROUND_N && attempts < maxAttempts) {
      attempts++;
      const lon = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
      const lat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
      if (!pointInGeoJSON(lat, lon, outline)) continue;
      const row = rasters.map(r => sampleRasterAt(r, lat, lon));
      if (row.every(v => v !== null)) backgroundX.push(row);
    }
    if (backgroundX.length < 10) return null;

    const nFeat = varIds.length;
    const allX = presenceX.concat(backgroundX);
    const stats = [];
    for (let j = 0; j < nFeat; j++) stats.push(standardizeCol(allX.map(r => r[j])));

    const X = presenceX.map(r => zRow(stats, r)).concat(backgroundX.map(r => zRow(stats, r)));
    const y = new Array(presenceX.length).fill(1).concat(new Array(backgroundX.length).fill(0));

    const model = fitLogisticRegression(X, y, FIT_OPTS);
    const cvAUC = kFoldAUC(X, y, 5, FIT_OPTS);

    const fullProbs = X.map(row => predictProb(model, row));
    const baseAUC = computeAUC(fullProbs, y) || 0.5;
    const importances = varIds.map((id, j) => {
      const shuffledCol = X.map(row => row[j]);
      for (let k = shuffledCol.length - 1; k > 0; k--) {
        const r = Math.floor(Math.random() * (k + 1));
        [shuffledCol[k], shuffledCol[r]] = [shuffledCol[r], shuffledCol[k]];
      }
      const shuffledProbs = X.map((row, i) => predictProb(model, row.map((v, jj) => jj === j ? shuffledCol[i] : v)));
      const shuffledAUC = computeAUC(shuffledProbs, y) || 0.5;
      return Math.max(0, baseAUC - shuffledAUC);
    });
    const impSum = importances.reduce((a, b) => a + b, 0);
    const importancePct = impSum > 0
      ? roundSharesTo100(importances.map(v => 100 * v / impSum))
      : roundSharesTo100(varIds.map(() => 100 / varIds.length));

    const curvePoints = 24;
    const curves = varIds.map((id, j) => {
      const colVals = allX.map(r => r[j]);
      const min = Math.min(...colVals), max = Math.max(...colVals);
      const points = [];
      for (let k = 0; k <= curvePoints; k++) {
        const raw = min + (k / curvePoints) * (max - min);
        const rowRaw = stats.map((s, jj) => jj === j ? raw : s.mean);
        points.push({ x: k / curvePoints, y: predictProb(model, zRow(stats, rowRaw)) });
      }
      return { id, min, max, points };
    });

    const presenceProbs = presenceX.map(r => predictProb(model, zRow(stats, r)));
    const meanHSI = presenceProbs.reduce((a, b) => a + b, 0) / presenceProbs.length;

    return {
      varIds, model, stats, cvAUC, meanHSI,
      nPresence: presenceX.length, nBackground: backgroundX.length,
      curvesById: Object.fromEntries(curves.map(c => [c.id, c])),
      importancePct
    };
  }

  function buildRunLogLines(fit) {
    if (!fit) return PROCESSING_STEPS;
    const varNames = fit.varIds.map(id => (RESPONSE_CURVES.find(c => c.id === id) || {}).variable || id).join(', ');
    return [
      `Loading ${fit.nPresence.toLocaleString()} occurrence records for selected species…`,
      `Sampling ${varNames} at each occurrence point…`,
      `Generating background (pseudo-absence) sample, n = ${fit.nBackground.toLocaleString()}…`,
      `Fitting regularized logistic response (${fit.varIds.length} predictor${fit.varIds.length > 1 ? 's' : ''})…`,
      `Cross-validating model, 5-fold — mean AUC ${fit.cvAUC !== null ? fit.cvAUC.toFixed(2) : 'n/a'}…`,
      `Predicting habitat suitability at occurrence points — mean HSI ${fit.meanHSI.toFixed(2)}…`,
      `Simulating future climate scenario and recomputing suitability…`,
      `Deriving risk classes from suitability change…`,
      `Model run complete.`
    ];
  }

  // RESPONSE_CURVES ids ('temp') don't match ENV_LAYERS ids ('temperature');
  // this maps a curve id to the layer it should sample from.
  const LAYER_ID_BY_CURVE_ID = { temp: 'temperature', rainfall: 'rainfall', dust: 'dust' };

  // Median of the raster's value at each occurrence point — the real,
  // observed "optimal" condition for the species at the points where it's
  // actually been recorded, rather than reading a value off the illustrative
  // response curve shape.
  function medianRasterValueAtPoints(raster, points) {
    const vals = [];
    points.forEach(([lat, lon]) => {
      const v = sampleRasterAt(raster, lat, lon);
      if (v !== null) vals.push(v);
    });
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  function computeVals() {
    const st = state;
    const t = T[st.lang];
    const isTh = st.lang === 'th';

    const usingUpload = st.dataSource === 'upload' && st.uploadedSpecies;
    const activeSpecies = usingUpload ? st.uploadedSpecies : SPECIES;
    const selectedSpecies = activeSpecies.filter(sp => st.speciesSel[sp.id]);
    const selectedCount = selectedSpecies.length;

    // Points stored as real [lat, lon] pairs, plotted directly, no transform.
    const visiblePoints = [];
    selectedSpecies.forEach(sp => sp.points.forEach((latlng) => {
      visiblePoints.push({ latlng, color: sp.color, species: isTh ? sp.thai : sp.common });
    }));

    const speciesCards = activeSpecies.map(sp => ({
      ...sp, displayName: isTh ? sp.thai : sp.common, totalFmt: sp.total.toLocaleString(),
      border: st.speciesSel[sp.id] ? sp.color : '#e6e1d2', op: st.speciesSel[sp.id] ? '1' : '0.5'
    }));

    const legendSpecies = selectedSpecies.map(sp => ({ displayName: isTh ? sp.thai : sp.common, color: sp.color }));

    const allOccurrencePoints = activeSpecies.flatMap(sp => sp.points);
    // Real reported individuals per occurrence point (GBIF individualCount,
    // defaulting to 1 for records that don't specify a count) — used for the
    // population-change estimate below. Falls back to 1 for any species data
    // that doesn't carry a counts array (e.g. an uploaded CSV).
    const allOccurrenceWithCounts = activeSpecies.flatMap(sp =>
      sp.points.map((latlng, i) => ({ latlng, count: (sp.counts && sp.counts[i] !== undefined) ? sp.counts[i] : 1 })));
    const loadedLayers = st.layers.filter(l => l.raster);
    let resMatch = true, crsMatch = true;
    if (loadedLayers.length > 1) {
      const refRes = loadedLayers[0].raster.resX;
      const refEpsg = loadedLayers[0].raster.epsg;
      loadedLayers.forEach(l => {
        if (refRes && Math.abs(l.raster.resX - refRes) / refRes > 0.02) resMatch = false;
        if (l.raster.epsg !== refEpsg) crsMatch = false;
      });
    }
    const layersSummary = {
      loadedCount: loadedLayers.length, totalCount: st.layers.length,
      resMatch, crsMatch, hasMultiple: loadedLayers.length > 1
    };

    const STATUS_STYLE = {
      ready: { label: t.layers.ready, color: '#4f7942' },
      processing: { label: isTh ? 'กำลังอ่านไฟล์…' : 'Reading file…', color: '#8a6a4f' },
      error: { label: isTh ? 'อ่านไฟล์ไม่สำเร็จ' : 'Failed to read', color: '#c1573a' },
      not_loaded: { label: t.layers.notLoaded, color: '#b5652f' }
    };

    const groupOrder = ['Climate'];
    const extraGroups = [...new Set(st.layers.map(l => l.group))].filter(g => !groupOrder.includes(g));
    const layerGroups = [...groupOrder, ...extraGroups].map(g => ({
      name: g, displayName: t.layers.groups[g] || g,
      items: st.layers.filter(l => l.group === g).map(l => {
        const m = String(l.resolution).match(/^([\d.]*)\s*(.*)$/) || [];
        const resNum = m[1] || '';
        const resUnit = m[2] || '';
        const style = STATUS_STYLE[l.status] || STATUS_STYLE.not_loaded;
        let outsideCount = null;
        if (l.raster) outsideCount = countPointsOutsideRaster(l.raster, allOccurrencePoints);
        let stationPendingNote = null, stationPendingError = false;
        if (l.stationPending) {
          if (l.stationPending.parseError) {
            stationPendingNote = (isTh ? 'อ่านไฟล์ไม่สำเร็จ: ' : 'Failed to parse: ') + l.stationPending.parseError;
            stationPendingError = true;
          } else if (!l.stationPending.stations.length) {
            stationPendingNote = isTh ? 'ไม่พบจุดสถานีที่อ่านได้ในไฟล์นี้' : 'No readable station points found in this file';
            stationPendingError = true;
          } else {
            stationPendingNote = l.stationPending.stations.length.toLocaleString() + (isTh ? ' สถานี' : ' stations')
              + (l.stationPending.errorCount ? ', ' + l.stationPending.errorCount + (isTh ? ' แถวข้าม' : ' skipped') : '')
              + (l.stationPending.valueLabel ? ' — ' + l.stationPending.valueLabel : '');
          }
        }
        const stationMetaNote = l.stationMeta
          ? '✓ ' + (isTh ? 'สร้างจาก ' : 'Built from ') + l.stationMeta.count.toLocaleString() + (isTh ? ' สถานี' : ' stations')
            + (l.stationMeta.errorCount ? ', ' + l.stationMeta.errorCount + (isTh ? ' แถวข้าม' : ' skipped') : '')
          : null;
        return {
          ...l, resNum, resUnit,
          statusLabel: style.label, statusColor: style.color,
          sizeWarning: l.sizeMB && l.sizeMB > RASTER_SIZE_WARNING_MB,
          sizeMBFmt: l.sizeMB ? l.sizeMB.toFixed(1) : null,
          crsLabel: l.raster ? epsgLabel(l.raster.epsg) : null,
          bboxLabel: l.raster ? l.raster.bbox.map(v => v.toFixed(2)).join(', ') : null,
          rangeLabel: l.raster && l.raster.min !== null ? l.raster.min.toFixed(2) + ' – ' + l.raster.max.toFixed(2) : null,
          nodataLabel: l.raster && l.raster.nodata !== null ? String(l.raster.nodata) : null,
          outsideCount,
          hasDefaultSample: DEFAULT_RASTERS.some(d => d.layerId === l.id),
          stationPendingNote, stationPendingError, stationMetaNote
        };
      })
    })).filter(g => g.items.length);

    const unmatchedFiles = st.unmatchedRasterFiles.map(u => ({
      ...u,
      statusLabel: u.status === 'ready' ? (isTh ? 'อ่านไฟล์แล้ว — เลือกตัวแปรด้านล่าง' : 'Parsed — choose a variable below')
        : u.status === 'error' ? (isTh ? 'อ่านไฟล์ไม่สำเร็จ' : 'Failed to read')
        : (isTh ? 'กำลังอ่านไฟล์…' : 'Reading file…')
    }));

    const validRecordsFmt = selectedSpecies.reduce((sum, sp) => sum + sp.total, 0).toLocaleString();
    const validNote = '✓ ' + validRecordsFmt + (isTh ? ' ระเบียนที่ผ่านการตรวจสอบจาก ' + selectedCount + ' ชนิด' : ' valid records across ' + selectedCount + ' species');

    const canRun = st.dataValidated && st.layers.some(l => l.raster) && selectedCount > 0;
    const runBtnLabel = st.running ? t.simulation.running : (st.modelRun ? t.simulation.runAgain : t.simulation.run);
    const runBtnColor = st.running ? '#8a8f80' : 'linear-gradient(135deg, #4f7942, #1f7a8a)';
    const canRunNote = st.running ? t.simulation.notePipeline : (st.modelRun ? t.simulation.noteComplete : (canRun ? t.simulation.noteReady : t.simulation.noteBlocked));

    // fm is null until Run has been clicked with at least one climate layer
    // (temp/rainfall/dust) loaded — see fitHabitatModel(). Everything below
    // falls back to the illustrative RESPONSE_CURVES/VARIABLE_CONTRIBUTION
    // shapes (used pre-Run just to size the delta inputs) when it's absent.
    const fm = st.modelRun ? st.fittedModel : null;

    const contribBars = fm
      ? fm.varIds.map((id, j) => {
          const name = (RESPONSE_CURVES.find(c => c.id === id) || {}).variable || id;
          const pct = fm.importancePct[j];
          return { name, pct, displayName: t.variables[name] || name, width: Math.min(100, Math.round((pct / 40) * 100)) };
        }).sort((a, b) => b.pct - a.pct)
      : VARIABLE_CONTRIBUTION.map(v => ({ ...v, displayName: t.variables[v.name] || v.name, width: Math.round((v.pct / 40) * 100) }));

    const yearDeltas = st.settings.deltasByYear[st.settings.targetYear];
    const deltaByVarId = { temp: yearDeltas.tempDelta, rainfall: yearDeltas.rainfallDelta, dust: yearDeltas.dustDelta };
    const responseCurves = RESPONSE_CURVES.map(c => {
      const layer = st.layers.find(l => l.id === (LAYER_ID_BY_CURVE_ID[c.id] || c.id));
      const observedMedian = layer && layer.raster ? medianRasterValueAtPoints(layer.raster, allOccurrencePoints) : null;
      const fitted = fm && fm.curvesById[c.id];
      const min = fitted ? fitted.min : c.min;
      const max = fitted ? fitted.max : c.max;
      const points = fitted ? fitted.points : c.points;
      const peakPt = points.reduce((best, p) => p.y > best.y ? p : best, points[0]);
      const curveOptimal = min + peakPt.x * (max - min);
      const optimalValue = observedMedian !== null ? observedMedian : curveOptimal;
      const delta = deltaByVarId[c.id] || 0;
      // The scenario input's allowed range always stays at the configured
      // physical range (e.g. 20-44°C), not the fitted curve's observed data
      // envelope — so users can dial in an unprecedented value to see how
      // the model extrapolates, instead of being capped at whatever the
      // training data happened to cover.
      const inputMin = c.min, inputMax = c.max;
      const projectedValue = Math.min(inputMax, Math.max(inputMin, optimalValue + delta));
      const decimals = c.id === 'rainfall' ? 0 : 1;
      // Flags a value outside the range the fitted model actually saw in
      // the data — the response curve there is a straight-line
      // extrapolation of the fitted trend, not something learned from real
      // observations, so it shouldn't be read as a validated prediction.
      const isExtrapolated = !!fitted && (projectedValue < min || projectedValue > max);
      return {
        ...c, min, max, points, inputMin, inputMax, displayName: t.variables[c.variable] || c.variable,
        fitted: !!fitted, isExtrapolated,
        optimalValue, projectedValue, decimals,
        optimalFmt: optimalValue.toFixed(decimals),
        projectedFmt: projectedValue.toFixed(decimals),
        deltaFmt: (delta > 0 ? '+' : '') + delta.toFixed(decimals),
        pathSmall: 'M' + points.map(p => (p.x * 130).toFixed(1) + ',' + (60 - p.y * 60).toFixed(1)).join(' L ')
      };
    });

    // Projected Mean HSI: the fitted model's average predicted probability
    // at occurrence points using the *selected year's* delta-shifted
    // feature values, instead of the current real ones — a real number
    // that changes as the per-year temp/rainfall/dust inputs change.
    let projectedMeanHSI = null;
    if (fm) {
      const rasters = fm.varIds.map(id => st.layers.find(l => l.id === LAYER_ID_BY_CURVE_ID[id]).raster);
      const probs = [];
      allOccurrencePoints.forEach(([lat, lon]) => {
        const rawCur = rasters.map(r => sampleRasterAt(r, lat, lon));
        if (rawCur.some(v => v === null)) return;
        const rawProj = fm.varIds.map((id, j) => rawCur[j] + (deltaByVarId[id] || 0));
        probs.push(predictProb(fm.model, zRow(fm.stats, rawProj)));
      });
      projectedMeanHSI = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
    }

    // Estimated population change: currentPopulation is the real sum of
    // GBIF individualCount across all occurrence points (not a record
    // count) — 38,015 for the bundled dataset. projectedPopulation scales
    // each point's real count by the fitted model's local ratio of
    // projected-to-current predicted suitability (points outside the
    // loaded rasters keep their count unchanged, since there's nothing to
    // scale by). This is an illustrative scaling of real observed counts by
    // a real fitted local suitability ratio — not a demographic model (no
    // birth/death/migration), and it's presented that way in the UI.
    let currentPopulation = null, projectedPopulation = null;
    if (fm) {
      const rasters = fm.varIds.map(id => st.layers.find(l => l.id === LAYER_ID_BY_CURVE_ID[id]).raster);
      let curTotal = 0, projTotal = 0;
      allOccurrenceWithCounts.forEach(({ latlng, count }) => {
        curTotal += count;
        const [lat, lon] = latlng;
        const rawCur = rasters.map(r => sampleRasterAt(r, lat, lon));
        if (rawCur.some(v => v === null)) { projTotal += count; return; }
        const rawProj = fm.varIds.map((id, j) => rawCur[j] + (deltaByVarId[id] || 0));
        const pCur = predictProb(fm.model, zRow(fm.stats, rawCur));
        const pProj = predictProb(fm.model, zRow(fm.stats, rawProj));
        const ratio = pCur > 0.001 ? pProj / pCur : 1;
        projTotal += count * ratio;
      });
      currentPopulation = Math.round(curTotal);
      projectedPopulation = Math.round(projTotal);
    }

    // Forest × per-variable risk: for the currently selected forestRiskTab
    // variable (rainfall/temperature/dust), color each occurrence point by
    // that ONE variable's predicted suitability drop (holding the other
    // variables at their current/observed value), shown against the forest
    // cover basemap — to see whether at-risk points sit in low-forest areas.
    function pointVarRisk(varId, lat, lon) {
      if (!fm || !fm.varIds.includes(varId)) return null;
      const j = fm.varIds.indexOf(varId);
      const rasters = fm.varIds.map(id => st.layers.find(l => l.id === LAYER_ID_BY_CURVE_ID[id]).raster);
      const rawCur = rasters.map(r => sampleRasterAt(r, lat, lon));
      if (rawCur.some(v => v === null)) return null;
      const rawProj = rawCur.slice();
      rawProj[j] = rawCur[j] + (deltaByVarId[varId] || 0);
      const curP = predictProb(fm.model, zRow(fm.stats, rawCur));
      const projP = predictProb(fm.model, zRow(fm.stats, rawProj));
      return curP - projP;
    }
    function forestRiskColor(risk) {
      if (risk === null) return '#8a8f80';
      if (risk < 0.03) return '#6ea55a';
      if (risk < 0.12) return '#d9a441';
      return '#c1573a';
    }
    const forestRiskUsable = !!(fm && fm.varIds.includes(st.forestRiskTab));
    const forestRiskPoints = visiblePoints.map(pt => {
      if (!forestRiskUsable) return { latlng: pt.latlng, color: pt.color, species: pt.species, riskPct: null };
      const risk = pointVarRisk(st.forestRiskTab, pt.latlng[0], pt.latlng[1]);
      return {
        latlng: pt.latlng, color: forestRiskColor(risk), species: pt.species,
        riskPct: risk !== null ? Math.round(risk * 100) : null
      };
    });
    const forestLayer = st.layers.find(l => l.id === 'forest');
    const forestRiskLoaded = !!(forestLayer && forestLayer.raster && forestLayer.raster.imgUrl);

    let rasterTabInfo = null;
    if (st.mapTab === 'rainfall' || st.mapTab === 'temperature' || st.mapTab === 'dust') {
      const layer = st.layers.find(l => l.id === st.mapTab);
      rasterTabInfo = { loaded: !!(layer && layer.raster && layer.raster.imgUrl) };
    }

    const uploads = st.uploads.map(u => {
      let statusLabel;
      let color;
      if (u.status === 'ready') {
        statusLabel = t.occurrence.included + ' (' + (u.pointCount || 0).toLocaleString() + (isTh ? ' จุด' : ' pts') + (u.errorCount ? ', ' + u.errorCount + (isTh ? ' แถวข้าม' : ' skipped') : '') + ')';
        color = '#4f7942';
      } else if (u.status === 'error') {
        statusLabel = isTh ? 'อ่านไฟล์ไม่ได้ / รูปแบบไม่ถูกต้อง' : 'Unreadable / invalid format';
        color = '#c1573a';
      } else {
        statusLabel = isTh ? 'กำลังประมวลผล…' : 'Processing…';
        color = '#b5652f';
      }
      return { ...u, statusLabel, color };
    });

    return {
      t, isTh,
      langEnActive: st.lang === 'en', langThActive: st.lang === 'th',
      speciesCards, legendSpecies, layerGroups, layersSummary, unmatchedFiles,
      layerAssignOptions: st.layers.map(l => ({ id: l.id, displayName: l.name })),
      uploads, dataValidated: st.dataValidated, validNote,
      settings: st.settings,
      runBtnColor, runBtnLabel, canRunNote, running: st.running, runProgress: st.runProgress,
      lastLogLines: st.log.slice(-3),
      mapTab: st.mapTab, rasterTabInfo,
      visiblePoints, modelRun: st.modelRun, notRun: !st.modelRun,
      contribBars, responseCurves,
      meanHSI: fm ? fm.meanHSI : null, cvAUC: fm ? fm.cvAUC : null, projectedMeanHSI,
      currentPopulation, projectedPopulation,
      forestRiskTab: st.forestRiskTab, forestRiskUsable, forestRiskPoints, forestRiskLoaded,
      collapsedSections: st.collapsedSections
    };
  }

  function renderTop(v) {
    document.getElementById('appTitle').textContent = v.t.top.title;
    document.getElementById('appSubtitle').textContent = v.t.top.subtitle;
    document.getElementById('langEnBtn').classList.toggle('active', v.langEnActive);
    document.getElementById('langThBtn').classList.toggle('active', v.langThActive);
    document.getElementById('appFooter').textContent = v.t.footer.text;
  }

  const SHOW_UPLOADS = false; // file-upload dropzones (samples/raster/station) temporarily hidden

  function renderLeftCol(v) {
    const t = v.t;
    let html = '';

    html += `<div class="card accent-green">
      <div class="panel-head" data-action="toggleSection" data-id="samples" style="cursor:pointer">
        <div class="badge badge-green">01</div><div class="panel-title">${esc(t.samples.title)}</div>
        <div class="collapse-chevron">${v.collapsedSections.samples ? '▸' : '▾'}</div>
      </div>
      ${v.collapsedSections.samples ? '' : `
      ${v.speciesCards.map(sp => `
        <div class="species-row" style="border-color:${sp.border};opacity:${sp.op}" data-action="toggleSpecies" data-id="${sp.id}">
          <div class="species-dot" style="background:${sp.color}"></div>
          <div class="species-name">${esc(sp.displayName)}</div>
          <div class="species-total">${sp.totalFmt}</div>
        </div>`).join('')}
      ${SHOW_UPLOADS ? `
      <label for="csvUpload" class="dropzone"><div class="dropzone-label">${esc(t.samples.dropzone)}</div></label>
      <input id="csvUpload" type="file" accept=".csv,.txt" multiple style="display:none" data-onchange="fileUpload">` : ''}
      ${v.uploads.map(u => `
        <div class="upload-row"><div class="upload-name">${esc(u.name)}</div><div class="upload-status" style="color:${u.color}">${esc(u.statusLabel)}</div></div>`).join('')}
      ${SHOW_UPLOADS ? `
      <div class="btn-row">
        <div class="btn btn-tan" data-action="useSampleData">${esc(t.samples.useSample)}</div>
        <div class="btn btn-green" data-action="validateData">${esc(t.occurrence.validate)}</div>
      </div>` : ''}
      ${v.dataValidated ? `<div class="valid-note">${esc(v.validNote)}</div>` : ''}
      `}
    </div>`;

    html += `<div class="card accent-brown">
      <div class="panel-head" data-action="toggleSection" data-id="envLayers" style="cursor:pointer">
        <div class="badge badge-brown">02</div><div class="panel-title">${esc(t.envLayers.title)}</div>
        <div class="collapse-chevron">${v.collapsedSections.envLayers ? '▸' : '▾'}</div>
      </div>
      ${v.collapsedSections.envLayers ? '' : `
      <div class="raster-summary">${v.layersSummary.loadedCount}/${v.layersSummary.totalCount} ${esc(t.layers.loadedLabel)}${v.layersSummary.hasMultiple ? '  •  ' + esc(t.layers.resolution) + ' ' + (v.layersSummary.resMatch ? '✓' : '✗ ' + esc(t.layers.mismatch)) + '  •  CRS ' + (v.layersSummary.crsMatch ? '✓' : '✗ ' + esc(t.layers.mismatch)) : ''}</div>

      ${SHOW_UPLOADS ? `
      <label for="rasterUpload" id="rasterDropzone" class="dropzone raster-dropzone">
        <div class="dropzone-label">${esc(t.layers.rasterDropzone)}</div>
      </label>
      <input id="rasterUpload" type="file" accept=".tif,.tiff" multiple style="display:none" data-onchange="rasterUpload">` : ''}

      ${v.unmatchedFiles.length ? `
      <div class="unmatched-files">
        ${v.unmatchedFiles.map(u => `
          <div class="unmatched-row">
            <div class="unmatched-name">${esc(u.fileName)}</div>
            <div class="unmatched-status" style="color:${u.status === 'error' ? '#c1573a' : '#8a6a4f'}">${esc(u.statusLabel)}</div>
            ${u.status === 'ready' ? `
              <select data-onchange="assignUnmatchedRaster" data-temp-id="${u.tempId}">
                <option value="">${esc(t.layers.chooseVariable)}</option>
                ${v.layerAssignOptions.map(o => `<option value="${o.id}">${esc(o.displayName)}</option>`).join('')}
              </select>` : ''}
            <div class="layer-remove" data-action="dismissUnmatchedFile" data-id="${u.tempId}">×</div>
          </div>`).join('')}
      </div>` : ''}

      ${v.layerGroups.map(g => `
        <div class="group-label">${esc(g.displayName)}</div>
        ${g.items.map(l => `
          <div class="layer-row">
            <div class="layer-top">
              <input value="${esc(l.name)}" data-onchange="layerField" data-id="${l.id}" data-field="name">
              <div class="layer-status" style="color:${l.statusColor}">${esc(l.statusLabel)}</div>
              ${SHOW_UPLOADS ? `<div class="layer-remove" data-action="removeLayer" data-id="${l.id}">×</div>` : ''}
            </div>
            ${l.raster ? `
              <div class="raster-info">
                <div class="raster-info-file">${esc(l.fileName)} ${l.sizeMBFmt ? '(' + l.sizeMBFmt + ' MB' + (l.sizeWarning ? ' ⚠' : '') + ')' : ''}</div>
                <div class="raster-info-row">${esc(t.layers.resolution)}: ${l.raster.resX.toFixed(4)}  |  CRS: ${esc(l.crsLabel)}</div>
                <div class="raster-info-row">${esc(t.layers.valueRange)}: ${esc(l.rangeLabel)}  |  NoData: ${esc(l.nodataLabel)}</div>
                <div class="raster-info-row">${esc(t.layers.extent)}: ${esc(l.bboxLabel)}</div>
                ${l.source ? `<div class="raster-info-row">${esc(t.layers.source)}: ${l.sourceUrl ? `<a href="${esc(l.sourceUrl)}" target="_blank" rel="noopener">${esc(l.source)}</a>` : esc(l.source)}</div>` : ''}
                ${l.stationMetaNote ? `<div class="raster-info-row">${esc(l.stationMetaNote)}</div>` : ''}
                ${l.outsideCount > 0 ? `<div class="raster-warning">⚠ ${l.outsideCount.toLocaleString()} ${esc(t.layers.pointsOutside)}</div>` : ''}
                ${SHOW_UPLOADS ? `<div class="raster-change" data-action="removeRasterFromLayer" data-id="${l.id}">${esc(t.layers.changeFile)}</div>` : ''}
              </div>` : l.status === 'error' ? `<div class="raster-warning">⚠ ${esc(l.error || '')}</div>` : `
              <div class="layer-sub">
                <input class="res-num" type="number" value="${esc(l.resNum)}" data-onchange="layerResolution" data-id="${l.id}">
                <input class="res-unit" value="${esc(l.resUnit)}" data-onchange="layerResolution" data-id="${l.id}">
                <input class="res-source" value="${esc(l.source)}" data-onchange="layerField" data-id="${l.id}" data-field="source">
              </div>
              ${SHOW_UPLOADS ? `
              <div class="station-upload">
                <label class="dropzone station-dropzone" for="stationUpload_${l.id}">
                  <div class="dropzone-label">${esc(t.layers.stationDropzone)}</div>
                </label>
                <input id="stationUpload_${l.id}" type="file" accept=".txt,.js,.json" style="display:none" data-onchange="stationUpload" data-id="${l.id}">
                ${l.stationPendingNote ? `<div class="unmatched-status" style="color:${l.stationPendingError ? '#c1573a' : '#8a6a4f'}">${esc(l.stationPendingNote)}</div>` : ''}
                <div class="btn-row">
                  ${l.hasDefaultSample ? `<div class="btn btn-tan" data-action="useSampleRaster" data-id="${l.id}">${esc(t.samples.useSample)}</div>` : ''}
                  <div class="btn btn-green" data-action="validateStationData" data-id="${l.id}">${esc(t.occurrence.validate)}</div>
                </div>
              </div>` : ''}`}
          </div>`).join('')}
      `).join('')}
      `}
    </div>`;

    html += `<div class="card accent-blue">
      <div class="panel-head" data-action="toggleSection" data-id="climate" style="cursor:pointer">
        <div class="badge badge-blue">03</div><div class="panel-title">${esc(t.climate.title)}</div>
        <div class="collapse-chevron">${v.collapsedSections.climate ? '▸' : '▾'}</div>
      </div>
      ${v.collapsedSections.climate ? '' : `
      <div class="climate-sub-title">${esc(t.climate.projectTitle)}</div>
      <div class="field-row">
        <div class="field-label-row" style="margin-bottom:5px"><div>${esc(t.climate.yearLabel)}</div></div>
        <select data-onchange="setting" data-field="targetYear" data-numeric="true">
          ${[2025, 2030, 2050, 2070].map(y => `<option value="${y}" ${v.settings.targetYear === y ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      ${(() => {
        const curveById = Object.fromEntries(v.responseCurves.map(c => [c.id, c]));
        const box = (labelKey, field, curveId, unit, step) => {
          const c = curveById[curveId];
          return `<div class="field-row" style="margin-bottom:${curveId === 'dust' && !c.isExtrapolated ? '0' : '14px'}">
            <div class="field-label-row"><div>${esc(t.climate[labelKey])}</div></div>
            <div class="numeric-box">
              <input type="number" step="${step}" min="${c.inputMin}" max="${c.inputMax}" value="${c.projectedValue.toFixed(c.decimals)}" data-onchange="climateAbsolute" data-field="${field}">
              <span class="numeric-box-unit">${esc(unit)}</span>
            </div>
            ${c.isExtrapolated ? `<div class="extrapolation-warning">${esc(t.climate.extrapolationWarning)}</div>` : ''}
          </div>`;
        };
        return box('tempLabel', 'tempDelta', 'temp', '°C', '0.5')
          + box('rainfallLabel', 'rainfallDelta', 'rainfall', 'mm', '50')
          + box('dustLabel', 'dustDelta', 'dust', 'μg/m³', '1');
      })()}
      ${v.modelRun ? `
        <div class="climate-stats" style="margin-top:14px">
          ${v.responseCurves.filter(cv => cv.fitted).map(cv => `
            <div class="climate-stat-row"><div class="climate-stat-label">${esc(t.climate.projectedLabel)}: ${esc(cv.displayName)}</div><div class="climate-stat-value">${cv.projectedFmt} ${esc(cv.unit)}</div></div>`).join('')}
        </div>` : ''}
      <div class="climate-note">${esc(t.climate.note)}</div>
      `}
    </div>`;

    html += `<div class="run-btn" style="background:${v.runBtnColor}" data-action="runModel">▶ ${esc(v.runBtnLabel)}</div>
      <div class="run-note">${esc(v.canRunNote)}</div>
      ${v.running ? `
        <div class="run-log">
          <div class="run-log-bar"><div style="width:${v.runProgress}%"></div></div>
          <div class="run-log-lines">${v.lastLogLines.map(line => `<div>› ${esc(line)}</div>`).join('')}</div>
        </div>` : ''}`;

    document.getElementById('colLeftContent').innerHTML = html;
  }

  function renderRightCol(v) {
    const t = v.t;
    let html = '';

    html += `<div class="card accent-orange">
      <div class="panel-head"><div class="badge badge-orange">05</div><div class="panel-title">${esc(t.results.title)}</div></div>
      ${v.notRun ? `<div class="results-empty">${esc(t.results.noResults)}</div>`
        : v.meanHSI === null ? `<div class="results-empty">${esc(t.suitability.noModel)}</div>`
        : `<div class="results-summary">${esc(t.suitability.mean)} <b style="color:#23281f">${v.meanHSI.toFixed(2)}</b></div>
           <div class="results-summary" style="margin-top:4px">${esc(t.suitability.cvAuc)} <b style="color:#23281f">${v.cvAUC !== null ? v.cvAUC.toFixed(2) : '—'}</b></div>
           ${v.projectedMeanHSI !== null ? (() => {
             const diff = v.projectedMeanHSI - v.meanHSI;
             const diffColor = diff > 0.005 ? '#4f7942' : diff < -0.005 ? '#c1573a' : '#8a8f80';
             const diffStr = (diff > 0 ? '+' : '') + diff.toFixed(2);
             return `<div class="results-summary" style="margin-top:4px">${esc(t.climate.projectedHSI)} ${v.settings.targetYear}: <b style="color:#23281f">${v.projectedMeanHSI.toFixed(2)}</b> <span style="color:${diffColor}">(${diffStr} ${esc(t.climate.vsCurrent)})</span></div>`;
           })() : ''}
      ${v.modelRun ? `
        <div class="climate-note" style="margin-top:10px">
          Habitat suitability is modelled from environmental predictors. Population growth, mortality, and bird movement are not estimated by this model.
        </div>` : ''}
    </div>`;

    html += `<div class="card">
      <div class="results-head">
        <svg width="13" height="13" viewBox="0 0 13 13"><polyline points="0,11 4,5 7,8 13,1" fill="none" stroke="#4f7942" stroke-width="1.6"></polyline></svg>
        <div class="results-head-title">${esc(t.results.responseCurves)}</div>
      </div>
      ${v.modelRun ? `
        <div class="curve-grid">
          ${v.responseCurves.filter(c => c.fitted).map(c => `
            <div class="curve-card">
              <div class="curve-title">${esc(c.displayName)}</div>
              <svg viewBox="0 0 130 70" style="width:100%;height:auto;display:block;margin-top:4px">
                <line x1="0" y1="60" x2="130" y2="60" stroke="#e6e1d2"></line>
                <path d="${c.pathSmall}" fill="none" stroke="#4f7942" stroke-width="2"></path>
              </svg>
            </div>`).join('')}
        </div>` : `<div class="results-summary">${esc(t.results.noResults)}</div>`}
    </div>`;

    html += `<div class="card" style="margin-bottom:0">
      <div class="results-head">
        <svg width="13" height="13" viewBox="0 0 13 13"><rect x="0" y="7" width="2.5" height="6" fill="#b5652f"></rect><rect x="4" y="3" width="2.5" height="10" fill="#b5652f"></rect><rect x="8" y="0" width="2.5" height="13" fill="#b5652f"></rect></svg>
        <div class="results-head-title">${esc(t.results.variableImportance)}</div>
      </div>
      ${v.modelRun ? v.contribBars.map(b => `
        <div class="contrib-row">
          <div class="contrib-top"><div>${esc(b.displayName)}</div><div style="font-weight:600">${b.pct}%</div></div>
          <div class="contrib-bar-track"><div class="contrib-bar-fill" style="width:${b.width}%"></div></div>
        </div>`).join('') : `<div class="results-summary">${esc(t.results.noResults)}</div>`}
    </div>`;

    document.getElementById('colRightContent').innerHTML = html;
  }

  function renderMapChrome(v) {
    const t = v.t;
    const rasterTab = v.mapTab === 'rainfall' || v.mapTab === 'temperature' || v.mapTab === 'dust';

    document.getElementById('mapPanelTitle').textContent = t.mapPanel.title;
    document.getElementById('mapTabDist').textContent = t.mapPanel.distribution;
    document.getElementById('mapTabDist').classList.toggle('active', v.mapTab === 'distribution');
    document.getElementById('mapTabRainfall').textContent = t.mapPanel.rainfallMap;
    document.getElementById('mapTabRainfall').classList.toggle('active', v.mapTab === 'rainfall');
    document.getElementById('mapTabTemperature').textContent = t.mapPanel.temperatureMap;
    document.getElementById('mapTabTemperature').classList.toggle('active', v.mapTab === 'temperature');
    document.getElementById('mapTabDust').textContent = t.mapPanel.dustMap;
    document.getElementById('mapTabDust').classList.toggle('active', v.mapTab === 'dust');
    document.getElementById('mapRealNote').textContent = v.mapTab === 'dust' ? t.map.dustNote
      : (rasterTab ? t.map.rasterNote : t.map.realNote);

    const noResultsBox = document.getElementById('noResultsBox');
    const rasterMissing = rasterTab && !v.rasterTabInfo.loaded;
    noResultsBox.style.display = rasterMissing ? 'block' : 'none';
    noResultsBox.textContent = t.mapPanel.rasterNotLoaded;
    document.getElementById('leafletMap').style.display = rasterMissing ? 'none' : 'block';

    // Occurrence points always keep their species color/legend, before and
    // after Run — the fitted model's results live in the Results panel
    // instead of recoloring the map.
    document.getElementById('mapLegendSpecies').innerHTML = v.legendSpecies.map(l => `
      <div class="legend-item"><div class="legend-dot" style="background:${l.color}"></div>${esc(l.displayName)}</div>`).join('');
  }

  // --- Leaflet map: a single persistent map instance, updated in place so it
  // never gets torn down by the innerHTML re-renders above. ---
  let map, pointsLayer, rasterOverlay, boundaryOutline, boundsFitted = false;

  function initMap() {
    map = L.map('leafletMap', { scrollWheelZoom: true, preferCanvas: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map);
    pointsLayer = L.layerGroup().addTo(map);
  }

  let mapFullscreen = false;
  function toggleMapFullscreen() {
    mapFullscreen = !mapFullscreen;
    document.getElementById('mapWrap').classList.toggle('fullscreen', mapFullscreen);
    document.getElementById('mapFullscreenBtn').textContent = mapFullscreen ? '⤡' : '⤢';
    document.getElementById('mapFullscreenBtn').title = mapFullscreen ? 'Exit fullscreen' : 'Toggle fullscreen';
    setTimeout(() => { if (map) map.invalidateSize(); }, 260);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mapFullscreen) toggleMapFullscreen();
  });

  // On-map classed legend (Leaflet control), styled after the TMD Climate
  // Atlas legend: stacked color bands with the class boundary value at each
  // band's top edge, high value at top down to zero at the bottom.
  let classLegendControl = null;

  function buildClassLegendHtml(layerId, isTh) {
    const ramp = RASTER_RAMPS[layerId];
    const cfg = RASTER_CLASSES[layerId];
    const displayBreaks = cfg.legendBreaks || cfg.breaks;
    const title = layerId === 'rainfall' ? (isTh ? 'ปริมาณฝน' : 'Rainfall')
      : layerId === 'dust' ? (isTh ? 'ฝุ่น PM2.5' : 'PM2.5')
      : (isTh ? 'อุณหภูมิ' : 'Temperature');
    let rows = '';
    for (let i = displayBreaks.length - 1; i >= 1; i--) {
      const lo = displayBreaks[i - 1], hi = displayBreaks[i];
      const [r, g, b] = classColor(ramp, cfg.breaks, (lo + hi) / 2);
      rows += `<div class="raster-legend-row" style="background:rgb(${r},${g},${b})"><span class="raster-legend-num">${hi}</span></div>`;
    }
    rows += `<div class="raster-legend-row raster-legend-row-zero"><span class="raster-legend-num">${displayBreaks[0]}</span></div>`;
    return `<div class="raster-legend"><div class="raster-legend-title">${esc(title)} (${esc(cfg.unit)})</div><div class="raster-legend-list">${rows}</div></div>`;
  }

  function updateClassLegend(layerId, isTh) {
    if (!classLegendControl) {
      classLegendControl = L.control({ position: 'bottomright' });
      classLegendControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'raster-legend-control');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      };
      classLegendControl.addTo(map);
    }
    classLegendControl.getContainer().innerHTML = buildClassLegendHtml(layerId, isTh);
  }

  function removeClassLegend() {
    if (classLegendControl) { map.removeControl(classLegendControl); classLegendControl = null; }
  }

  function pointStyle(pt) {
    return { fillColor: pt.color, popup: esc(pt.species) };
  }

  function updateLeafletLayers(v) {
    if (!map) return;
    pointsLayer.clearLayers();
    if (rasterOverlay) { map.removeLayer(rasterOverlay); rasterOverlay = null; }
    if (boundaryOutline) { map.removeLayer(boundaryOutline); boundaryOutline = null; }

    const rasterTab = v.mapTab === 'rainfall' || v.mapTab === 'temperature' || v.mapTab === 'dust';

    if (rasterTab) {
      if (v.rasterTabInfo.loaded) {
        const layer = state.layers.find(l => l.id === v.mapTab);
        const [west, south, east, north] = layer.raster.bbox;
        rasterOverlay = L.imageOverlay(layer.raster.imgUrl, [[south, west], [north, east]], { opacity: 0.7 }).addTo(map);
        if (state.provinceBoundaries) {
          boundaryOutline = L.geoJSON(state.provinceBoundaries, {
            style: { color: '#23281f', weight: 0.7, opacity: 0.55, fill: false },
            onEachFeature: (feature, featureLayer) => {
              const name = v.isTh ? feature.properties.th : feature.properties.en;
              featureLayer.bindTooltip(name, { permanent: true, direction: 'center', className: 'province-label' });
            }
          }).addTo(map);
        } else {
          boundaryOutline = L.geoJSON(THAILAND_BOUNDARY, { style: { color: '#23281f', weight: 1.2, fill: false } }).addTo(map);
        }
        updateClassLegend(v.mapTab, v.isTh);
      } else {
        removeClassLegend();
      }
      v.visiblePoints.forEach(pt => {
        const { fillColor, popup } = pointStyle(pt);
        L.circleMarker(pt.latlng, {
          radius: 3, color: '#ffffff', weight: 1, fillColor, fillOpacity: 0.9
        }).bindPopup(popup).addTo(pointsLayer);
      });
      return;
    }
    removeClassLegend();

    // Distribution tab: a light Thailand outline for context, on top of the
    // real OSM basemap (no permanent labels — the basemap already carries
    // place names at this zoom).
    const outlineSource = state.provinceBoundaries || THAILAND_BOUNDARY;
    boundaryOutline = L.geoJSON(outlineSource, { style: { color: '#3a4033', weight: 0.7, opacity: 0.5, fill: false } }).addTo(map);

    v.visiblePoints.forEach(pt => {
      const { fillColor, popup } = pointStyle(pt);
      L.circleMarker(pt.latlng, {
        radius: 4, color: '#ffffff', weight: 1, fillColor, fillOpacity: 0.9
      }).bindPopup(popup).addTo(pointsLayer);
    });

    if (!boundsFitted && v.visiblePoints.length) {
      map.fitBounds(L.latLngBounds(v.visiblePoints.map(p => p.latlng)), { padding: [24, 24] });
      boundsFitted = true;
    }
  }

  // Forest cover as a fixed basemap across 3 tabs (one per climate
  // variable), with occurrence points colored by that single variable's
  // predicted risk — lets a viewer see whether at-risk points sit in
  // low-forest areas. Falls back to species-colored points (and a note
  // explaining why) until a model has actually been fit.
  function renderForestRiskChrome(v) {
    const t = v.t;
    document.getElementById('forestRiskPanelTitle').textContent = t.mapPanel.forestRiskTitle;
    document.getElementById('riskTabRainfall').textContent = t.mapPanel.riskRainfall;
    document.getElementById('riskTabRainfall').classList.toggle('active', v.forestRiskTab === 'rainfall');
    document.getElementById('riskTabTemperature').textContent = t.mapPanel.riskTemperature;
    document.getElementById('riskTabTemperature').classList.toggle('active', v.forestRiskTab === 'temp');
    document.getElementById('riskTabDust').textContent = t.mapPanel.riskDust;
    document.getElementById('riskTabDust').classList.toggle('active', v.forestRiskTab === 'dust');

    const gradientEl = document.getElementById('forestRiskGradient');
    const scaleLabelsEl = document.getElementById('forestRiskScaleLabels');
    const legendEl = document.getElementById('forestRiskLegendSpecies');

    if (v.forestRiskUsable) {
      gradientEl.style.display = 'block';
      gradientEl.style.background = 'linear-gradient(to right,#6ea55a,#d9a441,#c1573a)';
      scaleLabelsEl.style.display = 'flex';
      scaleLabelsEl.innerHTML = `<div>${esc(t.mapPanel.riskLow)}</div><div>${esc(t.mapPanel.riskHigh)}</div>`;
      legendEl.innerHTML = '';
      document.getElementById('forestRiskNote').textContent = t.map.forestRiskNoteFit;
    } else {
      gradientEl.style.display = 'none';
      scaleLabelsEl.style.display = 'none';
      legendEl.innerHTML = v.legendSpecies.map(l => `
        <div class="legend-item"><div class="legend-dot" style="background:${l.color}"></div>${esc(l.displayName)}</div>`).join('');
      document.getElementById('forestRiskNote').textContent = t.map.forestRiskNoteNotFit;
    }
  }

  // --- Second Leaflet map: forest cover as a fixed basemap, points colored
  // by whichever single climate variable's risk is selected. Separate
  // persistent instance so it doesn't interfere with the main map above. ---
  let forestRiskMap, forestRiskPointsLayer, forestRiskRasterOverlay, forestRiskBoundary, forestRiskBoundsFitted = false;

  function initForestRiskMap() {
    forestRiskMap = L.map('forestRiskMap', { scrollWheelZoom: true, preferCanvas: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(forestRiskMap);
    forestRiskPointsLayer = L.layerGroup().addTo(forestRiskMap);
  }

  function updateForestRiskMap(v) {
    if (!forestRiskMap) return;
    forestRiskPointsLayer.clearLayers();
    if (forestRiskRasterOverlay) { forestRiskMap.removeLayer(forestRiskRasterOverlay); forestRiskRasterOverlay = null; }
    if (forestRiskBoundary) { forestRiskMap.removeLayer(forestRiskBoundary); forestRiskBoundary = null; }

    if (v.forestRiskLoaded) {
      const layer = state.layers.find(l => l.id === 'forest');
      const [west, south, east, north] = layer.raster.bbox;
      forestRiskRasterOverlay = L.imageOverlay(layer.raster.imgUrl, [[south, west], [north, east]], { opacity: 0.7 }).addTo(forestRiskMap);
    }
    const outlineSource = state.provinceBoundaries || THAILAND_BOUNDARY;
    forestRiskBoundary = L.geoJSON(outlineSource, { style: { color: '#23281f', weight: 0.7, opacity: 0.5, fill: false } }).addTo(forestRiskMap);

    v.forestRiskPoints.forEach(pt => {
      const popup = esc(pt.species) + (pt.riskPct !== null ? ' — ' + (pt.riskPct > 0 ? '−' : '+') + Math.abs(pt.riskPct) + '% HSI' : '');
      L.circleMarker(pt.latlng, {
        radius: 3, color: '#ffffff', weight: 1, fillColor: pt.color, fillOpacity: 0.9
      }).bindPopup(popup).addTo(forestRiskPointsLayer);
    });

    if (!forestRiskBoundsFitted && v.forestRiskPoints.length) {
      forestRiskMap.fitBounds(L.latLngBounds(v.forestRiskPoints.map(p => p.latlng)), { padding: [24, 24] });
      forestRiskBoundsFitted = true;
    }
  }

  function renderCollapse() {
    const grid = document.querySelector('.grid');
    grid.style.setProperty('--left-w', state.leftCollapsed ? '20px' : '330px');
    grid.style.setProperty('--right-w', state.rightCollapsed ? '20px' : '300px');
    document.getElementById('colLeft').classList.toggle('collapsed', state.leftCollapsed);
    document.getElementById('colRight').classList.toggle('collapsed', state.rightCollapsed);
    document.getElementById('toggleLeftBtn').textContent = state.leftCollapsed ? '›' : '‹';
    document.getElementById('toggleRightBtn').textContent = state.rightCollapsed ? '‹' : '›';
  }

  function render() {
    const v = computeVals();
    renderTop(v);
    renderLeftCol(v);
    renderRightCol(v);
    renderMapChrome(v);
    renderForestRiskChrome(v);
    renderCollapse();
    updateLeafletLayers(v);
    updateForestRiskMap(v);
  }

  const DEFAULT_RASTERS = [
    { layerId: 'rainfall', url: './assets/rasters/rainfall_annual_tmd_1991-2020.tif', name: 'rainfall_annual_tmd_1991-2020.tif' },
    { layerId: 'temperature', url: './assets/rasters/mean_temp_annual_tmd_1991-2020.tif', name: 'mean_temp_annual_tmd_1991-2020.tif' },
    { layerId: 'forest', url: './assets/rasters/forest_cover_2025_hansen.tif', name: 'forest_cover_2025_hansen.tif' },
    { layerId: 'dust', url: './assets/rasters/pm25_regional_2014-2024.tif', name: 'pm25_regional_2014-2024.tif' }
  ];

  function loadDefaultRasters() {
    DEFAULT_RASTERS.forEach(({ layerId, url, name }) => {
      state.layers = state.layers.map(l => l.id === layerId ? { ...l, status: 'processing' } : l);
      render();
      fetchGeoTiff(url, name).then(raster => {
        attachRasterImage(raster, layerId);
        state.layers = state.layers.map(l => l.id === layerId ? { ...l, status: 'ready', raster, fileName: name, sizeMB: raster.sizeMB } : l);
        render();
      }).catch(err => {
        state.layers = state.layers.map(l => l.id === layerId ? { ...l, status: 'not_loaded' } : l);
        console.error(err);
        render();
      });
    });
  }

  function boot() {
    initMap();
    initForestRiskMap();
    render();
    loadDefaultRasters();
    fetch('./assets/thailand-provinces.geojson')
      .then(r => { if (!r.ok) throw new Error('Failed to load province boundaries'); return r.json(); })
      .then(geo => { state.provinceBoundaries = geo; render(); })
      .catch(err => console.error(err));
    // The precise national outline (derived from the same province data as
    // the boundary lines above) replaces the coarse fallback used to clip
    // raster pixels, so the colored area lines up with those lines instead
    // of leaving a gap at the coastline. Re-clip any rasters that already
    // loaded with the coarse fallback once this arrives.
    fetch('./assets/thailand-outline.geojson')
      .then(r => { if (!r.ok) throw new Error('Failed to load Thailand outline'); return r.json(); })
      .then(geo => {
        state.thailandOutline = geo;
        state.layers = state.layers.map(l => {
          if (l.raster && RASTER_RAMPS[l.id]) attachRasterImage(l.raster, l.id);
          return l;
        });
        render();
      })
      .catch(err => console.error(err));
  }

  boot();
})();
