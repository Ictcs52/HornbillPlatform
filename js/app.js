(function () {
  'use strict';

  const state = {
    lang: 'en',
    mapTab: 'distribution',
    speciesSel: { great: true, wreathed: true, rufous: true, rhino: true, helmeted: true },
    layers: ENV_LAYERS.map(l => ({ ...l })),
    settings: { targetYear: 2035, tempDelta: 0, rainfallDelta: 0, dustDelta: 0 },
    dataValidated: false,
    running: false,
    runProgress: 0,
    modelRun: false,
    log: [],
    uploads: [],
    dataSource: 'sample', // 'sample' | 'upload'
    uploadedRows: [],
    uploadedSpecies: null,
    unmatchedRasterFiles: [],
    leftCollapsed: false,
    rightCollapsed: false,
    provinceBoundaries: null
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
    return Array.from(groups.values()).map(g => ({ ...g, total: g.points.length }));
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function updateSetting(key, val) { state.settings[key] = val; render(); }
  function setLang(l) { state.lang = l; render(); }
  function setMapTab(tab) { state.mapTab = tab; render(); }
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
      const domain = classes ? [classes.breaks[0], classes.breaks[classes.breaks.length - 1]] : null;
      raster.imgUrl = renderRasterToDataUrl(raster, ramp, THAILAND_BOUNDARY, domain);
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
  function addLayer() {
    const id = 'custom' + Date.now();
    state.layers = [...state.layers, { id, name: 'New Variable', group: 'Climate', resolution: '1km', source: 'Custom', status: 'not_loaded' }];
    render();
  }

  function runModel() {
    if (state.running) return;
    const steps = PROCESSING_STEPS;
    state.running = true;
    state.runProgress = 0;
    state.log = [];
    state.modelRun = false;
    render();
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
  }

  const ACTIONS = {
    setLang, setMapTab, toggleSpecies, validateData, useSampleData,
    removeLayer, removeRasterFromLayer,
    addLayer, runModel, toggleMapFullscreen,
    dismissUnmatchedFile, toggleLeftPanel, toggleRightPanel
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
    } else if (onchange === 'fileUpload') {
      onFileUpload(e);
    } else if (onchange === 'rasterUpload') {
      handleRasterFiles(el.files);
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

  // Piecewise-linear lookup of a response curve at a real (non-normalized) value.
  function evalCurveAt(curve, value) {
    const x = Math.max(0, Math.min(1, (value - curve.min) / (curve.max - curve.min)));
    const pts = curve.points;
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i].x) {
        const p0 = pts[i - 1], p1 = pts[i];
        const t = (x - p0.x) / ((p1.x - p0.x) || 1);
        return p0.y + t * (p1.y - p0.y);
      }
    }
    return pts[pts.length - 1].y;
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
        return {
          ...l, resNum, resUnit,
          statusLabel: style.label, statusColor: style.color,
          sizeWarning: l.sizeMB && l.sizeMB > RASTER_SIZE_WARNING_MB,
          sizeMBFmt: l.sizeMB ? l.sizeMB.toFixed(1) : null,
          crsLabel: l.raster ? epsgLabel(l.raster.epsg) : null,
          bboxLabel: l.raster ? l.raster.bbox.map(v => v.toFixed(2)).join(', ') : null,
          rangeLabel: l.raster && l.raster.min !== null ? l.raster.min.toFixed(2) + ' – ' + l.raster.max.toFixed(2) : null,
          nodataLabel: l.raster && l.raster.nodata !== null ? String(l.raster.nodata) : null,
          outsideCount
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

    const contribBars = VARIABLE_CONTRIBUTION.map(v => ({ ...v, displayName: t.variables[v.name] || v.name, width: Math.round((v.pct / 40) * 100) }));

    const pctById = {};
    RESPONSE_CURVES.forEach(c => {
      const vc = VARIABLE_CONTRIBUTION.find(v => v.name === c.variable);
      pctById[c.id] = vc ? vc.pct : 1;
    });

    const deltaByVarId = { temp: st.settings.tempDelta, rainfall: st.settings.rainfallDelta, dust: st.settings.dustDelta };
    const responseCurves = RESPONSE_CURVES.map(c => {
      const peakPt = c.points.reduce((best, p) => p.y > best.y ? p : best, c.points[0]);
      const optimalValue = c.min + peakPt.x * (c.max - c.min);
      const delta = deltaByVarId[c.id] || 0;
      const projectedValue = Math.min(c.max, Math.max(c.min, optimalValue + delta));
      const decimals = c.id === 'rainfall' ? 0 : 1;
      return {
        ...c, displayName: t.variables[c.variable] || c.variable,
        optimalFmt: optimalValue.toFixed(decimals),
        projectedFmt: projectedValue.toFixed(decimals),
        deltaFmt: (delta > 0 ? '+' : '') + delta.toFixed(decimals),
        pathSmall: 'M' + c.points.map(p => (p.x * 130).toFixed(1) + ',' + (60 - p.y * 60).toFixed(1)).join(' L ')
      };
    });

    // Per-point risk: for each occurrence point, sample the loaded rainfall/
    // temperature/dust rasters at that location, evaluate the response curve
    // at the current vs. delta-shifted value, and weight the suitability
    // drop by each variable's model contribution. Falls back to "no data"
    // wherever a layer isn't loaded (e.g. dust, which has no default raster).
    function pointRisk(lat, lon) {
      let weightedDrop = 0, weightSum = 0;
      RESPONSE_CURVES.forEach(c => {
        const layer = st.layers.find(l => l.id === c.id);
        if (!layer || !layer.raster) return;
        const v = sampleRasterAt(layer.raster, lat, lon);
        if (v === null) return;
        const delta = deltaByVarId[c.id] || 0;
        const curY = evalCurveAt(c, v);
        const projY = evalCurveAt(c, v + delta);
        const w = pctById[c.id] || 1;
        weightedDrop += w * (curY - projY);
        weightSum += w;
      });
      return weightSum ? weightedDrop / weightSum : null;
    }

    let highRiskPct = 0;
    if (st.modelRun) {
      const risks = allOccurrencePoints.map(([lat, lon]) => pointRisk(lat, lon)).filter(r => r !== null);
      highRiskPct = risks.length ? Math.round(100 * risks.filter(r => r > 0.05).length / risks.length) : 0;
    }

    let rasterTabInfo = null;
    if (st.mapTab === 'rainfall' || st.mapTab === 'temperature') {
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
      visiblePoints, modelRun: st.modelRun, notRun: !st.modelRun, highRiskPct,
      contribBars, responseCurves, pointRisk
    };
  }

  function renderTop(v) {
    document.getElementById('appTitle').textContent = v.t.top.title;
    document.getElementById('appSubtitle').textContent = v.t.top.subtitle;
    document.getElementById('langEnBtn').classList.toggle('active', v.langEnActive);
    document.getElementById('langThBtn').classList.toggle('active', v.langThActive);
  }

  function renderLeftCol(v) {
    const t = v.t;
    let html = '';

    html += `<div class="card accent-green">
      <div class="panel-head"><div class="badge badge-green">01</div><div class="panel-title">${esc(t.samples.title)}</div></div>
      ${v.speciesCards.map(sp => `
        <div class="species-row" style="border-color:${sp.border};opacity:${sp.op}" data-action="toggleSpecies" data-id="${sp.id}">
          <div class="species-dot" style="background:${sp.color}"></div>
          <div class="species-name">${esc(sp.displayName)}</div>
          <div class="species-total">${sp.totalFmt}</div>
        </div>`).join('')}
      <label for="csvUpload" class="dropzone"><div class="dropzone-label">${esc(t.samples.dropzone)}</div></label>
      <input id="csvUpload" type="file" accept=".csv,.txt" multiple style="display:none" data-onchange="fileUpload">
      ${v.uploads.map(u => `
        <div class="upload-row"><div class="upload-name">${esc(u.name)}</div><div class="upload-status" style="color:${u.color}">${esc(u.statusLabel)}</div></div>`).join('')}
      <div class="btn-row">
        <div class="btn btn-tan" data-action="useSampleData">${esc(t.samples.useSample)}</div>
        <div class="btn btn-green" data-action="validateData">${esc(t.occurrence.validate)}</div>
      </div>
      ${v.dataValidated ? `<div class="valid-note">${esc(v.validNote)}</div>` : ''}
    </div>`;

    html += `<div class="card accent-brown">
      <div class="panel-head"><div class="badge badge-brown">02</div><div class="panel-title">${esc(t.envLayers.title)}</div></div>

      <div class="raster-summary">${v.layersSummary.loadedCount}/${v.layersSummary.totalCount} ${esc(t.layers.loadedLabel)}${v.layersSummary.hasMultiple ? '  •  ' + esc(t.layers.resolution) + ' ' + (v.layersSummary.resMatch ? '✓' : '✗ ' + esc(t.layers.mismatch)) + '  •  CRS ' + (v.layersSummary.crsMatch ? '✓' : '✗ ' + esc(t.layers.mismatch)) : ''}</div>

      <label for="rasterUpload" id="rasterDropzone" class="dropzone raster-dropzone">
        <div class="dropzone-label">${esc(t.layers.rasterDropzone)}</div>
      </label>
      <input id="rasterUpload" type="file" accept=".tif,.tiff" multiple style="display:none" data-onchange="rasterUpload">

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
              <div class="layer-remove" data-action="removeLayer" data-id="${l.id}">×</div>
            </div>
            ${l.raster ? `
              <div class="raster-info">
                <div class="raster-info-file">${esc(l.fileName)} ${l.sizeMBFmt ? '(' + l.sizeMBFmt + ' MB' + (l.sizeWarning ? ' ⚠' : '') + ')' : ''}</div>
                <div class="raster-info-row">${esc(t.layers.resolution)}: ${l.raster.resX.toFixed(4)}  |  CRS: ${esc(l.crsLabel)}</div>
                <div class="raster-info-row">${esc(t.layers.valueRange)}: ${esc(l.rangeLabel)}  |  NoData: ${esc(l.nodataLabel)}</div>
                <div class="raster-info-row">${esc(t.layers.extent)}: ${esc(l.bboxLabel)}</div>
                ${l.source ? `<div class="raster-info-row">${esc(t.layers.source)}: ${l.sourceUrl ? `<a href="${esc(l.sourceUrl)}" target="_blank" rel="noopener">${esc(l.source)}</a>` : esc(l.source)}</div>` : ''}
                ${l.outsideCount > 0 ? `<div class="raster-warning">⚠ ${l.outsideCount.toLocaleString()} ${esc(t.layers.pointsOutside)}</div>` : ''}
                <div class="raster-change" data-action="removeRasterFromLayer" data-id="${l.id}">${esc(t.layers.changeFile)}</div>
              </div>` : l.status === 'error' ? `<div class="raster-warning">⚠ ${esc(l.error || '')}</div>` : `
              <div class="layer-sub">
                <input class="res-num" type="number" value="${esc(l.resNum)}" data-onchange="layerResolution" data-id="${l.id}">
                <input class="res-unit" value="${esc(l.resUnit)}" data-onchange="layerResolution" data-id="${l.id}">
                <input class="res-source" value="${esc(l.source)}" data-onchange="layerField" data-id="${l.id}" data-field="source">
              </div>`}
          </div>`).join('')}
      `).join('')}
    </div>`;

    html += `<div class="card accent-blue">
      <div class="panel-head"><div class="badge badge-blue">03</div><div class="panel-title">${esc(t.climate.title)}</div></div>
      <div class="climate-sub-title">${esc(t.climate.projectTitle)}</div>
      <div class="field-row">
        <div class="field-label-row" style="margin-bottom:5px"><div>${esc(t.climate.yearLabel)}</div></div>
        <select data-onchange="setting" data-field="targetYear" data-numeric="true">
          ${[2030, 2050, 2070].map(y => `<option value="${y}" ${v.settings.targetYear === y ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field-label-row"><div>${esc(t.climate.tempLabel)}</div><div>${v.settings.tempDelta >= 0 ? '+' : ''}${v.settings.tempDelta} °C</div></div>
        <input type="range" min="-5" max="5" step="0.5" value="${v.settings.tempDelta}" data-onchange="setting" data-field="tempDelta">
      </div>
      <div class="field-row">
        <div class="field-label-row"><div>${esc(t.climate.rainfallLabel)}</div><div>${v.settings.rainfallDelta >= 0 ? '+' : ''}${v.settings.rainfallDelta} mm</div></div>
        <input type="range" min="-1000" max="1000" step="50" value="${v.settings.rainfallDelta}" data-onchange="setting" data-field="rainfallDelta">
      </div>
      <div class="field-row" style="margin-bottom:0">
        <div class="field-label-row"><div>${esc(t.climate.dustLabel)}</div><div>${v.settings.dustDelta >= 0 ? '+' : ''}${v.settings.dustDelta} μg/m³</div></div>
        <input type="range" min="-30" max="30" step="1" value="${v.settings.dustDelta}" data-onchange="setting" data-field="dustDelta">
      </div>
      ${v.modelRun ? `
        <div class="climate-stats" style="margin-top:14px">
          ${v.responseCurves.map(cv => `
            <div class="climate-stat-row"><div class="climate-stat-label">${esc(t.climate.projectedLabel)}: ${esc(cv.displayName)}</div><div class="climate-stat-value">${cv.projectedFmt} ${esc(cv.unit)}</div></div>`).join('')}
        </div>` : ''}
      <div class="climate-note">${esc(t.climate.note)}</div>
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
      ${v.notRun ? `<div class="results-empty">${esc(t.results.noResults)}</div>` : `<div class="results-summary">${esc(t.suitability.mean)} <b style="color:#23281f">0.78</b></div>`}
      ${v.modelRun ? `
        <div class="climate-sub-title" style="margin-top:12px">${esc(t.climate.optimalTitle)}</div>
        <div class="climate-stats">
          ${v.responseCurves.map(cv => `
            <div class="climate-stat-row"><div class="climate-stat-label">${esc(cv.displayName)}</div><div class="climate-stat-value">${cv.optimalFmt} ${esc(cv.unit)}</div></div>`).join('')}
        </div>` : ''}
    </div>`;

    document.getElementById('colRightContent').innerHTML = html;
  }

  function renderMapExtra(v) {
    const t = v.t;
    let html = '';

    html += `<div class="card">
      <div class="results-head">
        <svg width="13" height="13" viewBox="0 0 13 13"><polyline points="0,11 4,5 7,8 13,1" fill="none" stroke="#4f7942" stroke-width="1.6"></polyline></svg>
        <div class="results-head-title">${esc(t.results.responseCurves)}</div>
      </div>
      ${v.modelRun ? `
        <div class="curve-grid">
          ${v.responseCurves.map(c => `
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

    document.getElementById('colMapExtra').innerHTML = html;
  }

  function renderMapChrome(v) {
    const t = v.t;
    const rasterTab = v.mapTab === 'rainfall' || v.mapTab === 'temperature';

    document.getElementById('mapPanelTitle').textContent = t.mapPanel.title;
    document.getElementById('mapTabDist').textContent = t.mapPanel.distribution;
    document.getElementById('mapTabDist').classList.toggle('active', v.mapTab === 'distribution');
    document.getElementById('mapTabRainfall').textContent = t.mapPanel.rainfallMap;
    document.getElementById('mapTabRainfall').classList.toggle('active', v.mapTab === 'rainfall');
    document.getElementById('mapTabTemperature').textContent = t.mapPanel.temperatureMap;
    document.getElementById('mapTabTemperature').classList.toggle('active', v.mapTab === 'temperature');
    document.getElementById('mapRealNote').textContent = rasterTab ? t.map.rasterNote : t.map.realNote;

    const noResultsBox = document.getElementById('noResultsBox');
    const rasterMissing = rasterTab && !v.rasterTabInfo.loaded;
    noResultsBox.style.display = rasterMissing ? 'block' : 'none';
    noResultsBox.textContent = t.mapPanel.rasterNotLoaded;
    document.getElementById('leafletMap').style.display = rasterMissing ? 'none' : 'block';

    const gradientEl = document.getElementById('mapGradient');
    const scaleLabelsEl = document.getElementById('mapScaleLabels');
    const speciesLegendEl = document.getElementById('mapLegendSpecies');
    const riskNoteEl = document.getElementById('mapRiskNote');

    // Once the model has run, every tab recolors occurrence points by
    // projected risk instead of species — so the risk gradient + note
    // replaces the species legend everywhere, not just on one dedicated tab.
    if (v.modelRun) {
      gradientEl.style.display = 'block';
      gradientEl.style.background = 'linear-gradient(to right,#6ea55a,#d9a441,#c1573a)';
      scaleLabelsEl.style.display = 'flex';
      scaleLabelsEl.innerHTML = `<div>${esc(v.t.mapPanel.low)}</div><div>${esc(v.t.mapPanel.high)}</div>`;
      riskNoteEl.style.display = 'block';
      riskNoteEl.innerHTML = `${esc(v.t.risk.highArea)} <b style="color:#c1573a">${v.highRiskPct}%</b> ${esc(v.t.risk.ofArea)}`;
      speciesLegendEl.innerHTML = '';
    } else {
      gradientEl.style.display = 'none';
      scaleLabelsEl.style.display = 'none';
      riskNoteEl.style.display = 'none';
      speciesLegendEl.innerHTML = v.legendSpecies.map(l => `
        <div class="legend-item"><div class="legend-dot" style="background:${l.color}"></div>${esc(l.displayName)}</div>`).join('');
    }
  }

  // --- Leaflet map: a single persistent map instance, updated in place so it
  // never gets torn down by the innerHTML re-renders above. ---
  let map, pointsLayer, rasterOverlay, boundaryOutline, boundsFitted = false;

  function initMap() {
    map = L.map('leafletMap', { scrollWheelZoom: true, preferCanvas: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
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

  function riskPointColor(risk) {
    if (risk === null) return '#8a8f80';
    if (risk < 0.03) return '#6ea55a';
    if (risk < 0.12) return '#d9a441';
    return '#c1573a';
  }

  // On-map classed legend (Leaflet control), styled after the TMD Climate
  // Atlas legend: stacked color bands with the class boundary value at each
  // band's top edge, high value at top down to zero at the bottom.
  let classLegendControl = null;

  function buildClassLegendHtml(layerId, isTh) {
    const ramp = RASTER_RAMPS[layerId];
    const cfg = RASTER_CLASSES[layerId];
    const domainMin = cfg.breaks[0], domainMax = cfg.breaks[cfg.breaks.length - 1];
    const title = layerId === 'rainfall' ? (isTh ? 'ปริมาณฝน' : 'Rainfall') : (isTh ? 'อุณหภูมิ' : 'Temperature');
    let rows = '';
    for (let i = cfg.breaks.length - 1; i >= 1; i--) {
      const lo = cfg.breaks[i - 1], hi = cfg.breaks[i];
      const [r, g, b] = rampColor(ramp, ((lo + hi) / 2 - domainMin) / (domainMax - domainMin));
      rows += `<div class="raster-legend-row" style="background:rgb(${r},${g},${b})"><span class="raster-legend-num">${hi}</span></div>`;
    }
    rows += `<div class="raster-legend-row raster-legend-row-zero"><span class="raster-legend-num">${cfg.breaks[0]}</span></div>`;
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

  // Once the model has run, every tab colors points by projected risk
  // instead of species — there's no separate "Compare Scenario" tab anymore.
  function pointStyle(v, pt) {
    if (!v.modelRun) return { fillColor: pt.color, popup: esc(pt.species) };
    const risk = v.pointRisk(pt.latlng[0], pt.latlng[1]);
    const popup = esc(pt.species) + (risk !== null ? ' — ' + (risk > 0 ? '−' : '+') + Math.abs(Math.round(risk * 100)) + '% HSI' : '');
    return { fillColor: riskPointColor(risk), popup };
  }

  function updateLeafletLayers(v) {
    if (!map) return;
    pointsLayer.clearLayers();
    if (rasterOverlay) { map.removeLayer(rasterOverlay); rasterOverlay = null; }
    if (boundaryOutline) { map.removeLayer(boundaryOutline); boundaryOutline = null; }

    const rasterTab = v.mapTab === 'rainfall' || v.mapTab === 'temperature';

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
        const { fillColor, popup } = pointStyle(v, pt);
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
      const { fillColor, popup } = pointStyle(v, pt);
      L.circleMarker(pt.latlng, {
        radius: 4, color: '#ffffff', weight: 1, fillColor, fillOpacity: 0.9
      }).bindPopup(popup).addTo(pointsLayer);
    });

    if (!boundsFitted && v.visiblePoints.length) {
      map.fitBounds(L.latLngBounds(v.visiblePoints.map(p => p.latlng)), { padding: [24, 24] });
      boundsFitted = true;
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
    renderMapExtra(v);
    renderMapChrome(v);
    renderCollapse();
    updateLeafletLayers(v);
  }

  const DEFAULT_RASTERS = [
    { layerId: 'rainfall', url: './assets/rasters/rainfall_annual_tmd_1991-2020.tif', name: 'rainfall_annual_tmd_1991-2020.tif' },
    { layerId: 'temperature', url: './assets/rasters/mean_temp_annual_tmd_1991-2020.tif', name: 'mean_temp_annual_tmd_1991-2020.tif' }
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
    render();
    loadDefaultRasters();
    fetch('./assets/thailand-provinces.geojson')
      .then(r => { if (!r.ok) throw new Error('Failed to load province boundaries'); return r.json(); })
      .then(geo => { state.provinceBoundaries = geo; render(); })
      .catch(err => console.error(err));
  }

  boot();
})();
