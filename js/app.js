(function () {
  'use strict';

  const state = {
    lang: 'en',
    settingsTab: 'basic',
    mapTab: 'distribution',
    speciesSel: { great: true, wreathed: true, rufous: true, rhino: true, helmeted: true },
    studyArea: 'western',
    layers: ENV_LAYERS.map(l => ({ ...l })),
    settings: { resolution: '100', testSplit: 25, regularization: 1.0, scenario: 'current', forestLoss: 15, replicates: 3 },
    dataValidated: false,
    layersChecked: false,
    running: false,
    runProgress: 0,
    modelRun: false,
    log: [],
    exportSel: { pdf: true, png: true, geotiff: false, csv: true },
    reportGenerated: false,
    uploads: [],
    boundaries: null,
    dataSource: 'sample', // 'sample' | 'upload'
    uploadedRows: [],
    uploadedSpecies: null
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
  function setSettingsTab(tab) { state.settingsTab = tab; render(); }
  function setMapTab(tab) { state.mapTab = tab; render(); }
  function toggleSpecies(id) { state.speciesSel[id] = !state.speciesSel[id]; render(); }
  function selectStudyArea(id) { state.studyArea = id; render(); }
  function validateData() { state.dataValidated = true; render(); }
  function useSampleData() {
    state.dataSource = 'sample';
    state.uploadedRows = [];
    state.uploadedSpecies = null;
    state.speciesSel = { great: true, wreathed: true, rufous: true, rhino: true, helmeted: true };
    state.dataValidated = true;
    render();
  }
  function checkLayers() {
    state.layers = state.layers.map(l => ({ ...l, status: 'ready' }));
    state.layersChecked = true;
    render();
  }
  function useSampleLayers() { checkLayers(); }
  function useSampleBoundary() { state.studyArea = 'western'; render(); }
  function updateLayerField(id, field, value) {
    state.layers = state.layers.map(l => l.id === id ? { ...l, [field]: value } : l);
    render();
  }
  function toggleLayerStatus(id) {
    state.layers = state.layers.map(l => l.id === id ? { ...l, status: l.status === 'ready' ? 'not_loaded' : 'ready' } : l);
    render();
  }
  function removeLayer(id) { state.layers = state.layers.filter(l => l.id !== id); render(); }
  function addLayer() {
    const id = 'custom' + Date.now();
    state.layers = [...state.layers, { id, name: 'New Variable', group: 'Vegetation', resolution: '100m', source: 'Custom', status: 'not_loaded' }];
    render();
  }
  function toggleExport(key) { state.exportSel[key] = !state.exportSel[key]; render(); }
  function generateReport() { state.reportGenerated = true; render(); }

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
    setLang, setSettingsTab, setMapTab, toggleSpecies, selectStudyArea, validateData,
    useSampleData, useSampleLayers, useSampleBoundary, toggleLayerStatus, removeLayer,
    addLayer, toggleExport, generateReport, runModel, toggleMapFullscreen
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
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.type !== 'range') return;
    const onchange = el.getAttribute('data-onchange');
    if (onchange === 'setting') {
      updateSetting(el.getAttribute('data-field'), Number(el.value));
    }
  });

  function computeVals() {
    const st = state;
    const t = T[st.lang];
    const isTh = st.lang === 'th';

    const usingUpload = st.dataSource === 'upload' && st.uploadedSpecies;
    const activeSpecies = usingUpload ? st.uploadedSpecies : SPECIES;
    const selectedSpecies = activeSpecies.filter(sp => st.speciesSel[sp.id]);
    const selectedCount = selectedSpecies.length;
    const studyArea = STUDY_AREAS.find(a => a.id === st.studyArea);

    // Both SPECIES (real GBIF records) and uploaded CSV data store points as
    // real [lat, lon] pairs, so they're plotted directly with no transform.
    const visiblePoints = [];
    selectedSpecies.forEach(sp => sp.points.forEach((latlng) => {
      visiblePoints.push({ latlng, color: sp.color, species: isTh ? sp.thai : sp.common });
    }));

    const speciesCards = activeSpecies.map(sp => ({
      ...sp, displayName: isTh ? sp.thai : sp.common, totalFmt: sp.total.toLocaleString(),
      border: st.speciesSel[sp.id] ? sp.color : '#e6e1d2', op: st.speciesSel[sp.id] ? '1' : '0.5'
    }));

    const studyAreaOptions = STUDY_AREAS.map(a => ({
      ...a, areaFmt: a.areaKm2.toLocaleString(), displayName: isTh ? a.thai : a.name,
      selected: st.studyArea === a.id
    }));

    const legendSpecies = selectedSpecies.map(sp => ({ displayName: isTh ? sp.thai : sp.common, color: sp.color }));

    const groupOrder = ['Topography', 'Vegetation', 'Climate', 'Human Disturbance'];
    const extraGroups = [...new Set(st.layers.map(l => l.group))].filter(g => !groupOrder.includes(g));
    const layerGroups = [...groupOrder, ...extraGroups].map(g => ({
      name: g, displayName: t.layers.groups[g] || g,
      items: st.layers.filter(l => l.group === g).map(l => {
        const m = String(l.resolution).match(/^([\d.]*)\s*(.*)$/) || [];
        const resNum = m[1] || '';
        const resUnit = m[2] || '';
        return {
          ...l, resNum, resUnit,
          statusLabel: l.status === 'ready' ? t.layers.ready : t.layers.notLoaded,
          statusColor: l.status === 'ready' ? '#4f7942' : '#b5652f'
        };
      })
    })).filter(g => g.items.length);

    const validRecordsFmt = selectedSpecies.reduce((sum, sp) => sum + sp.total, 0).toLocaleString();
    const validNote = '✓ ' + validRecordsFmt + (isTh ? ' ระเบียนที่ผ่านการตรวจสอบจาก ' + selectedCount + ' ชนิด' : ' valid records across ' + selectedCount + ' species');

    const canRun = st.dataValidated && st.layersChecked && selectedCount > 0;
    const runBtnLabel = st.running ? t.simulation.running : (st.modelRun ? t.simulation.runAgain : t.simulation.run);
    const runBtnColor = st.running ? '#8a8f80' : '#4f7942';
    const canRunNote = st.running ? t.simulation.notePipeline : (st.modelRun ? t.simulation.noteComplete : (canRun ? t.simulation.noteReady : t.simulation.noteBlocked));

    const contribBars = VARIABLE_CONTRIBUTION.map(v => ({ ...v, displayName: t.variables[v.name] || v.name, width: Math.round((v.pct / 25) * 100) }));
    const responseCurves = RESPONSE_CURVES.map(c => ({
      ...c, displayName: t.variables[c.variable] || c.variable,
      pathSmall: 'M' + c.points.map(p => (p.x * 130).toFixed(1) + ',' + (60 - p.y * 60).toFixed(1)).join(' L ')
    }));

    const scenarioWord = t.scenarioWord[st.settings.scenario] || st.settings.scenario;
    const exportFormats = ['pdf', 'png', 'geotiff', 'csv'].map(key => ({
      key, label: t.exportScreen.formats[key].label, bg: st.exportSel[key] ? '#4f7942' : '#e6e1d2'
    }));
    const generatedNote = '✓ ' + (isTh ? 'สร้างรายงานแล้ว' : 'Report generated') + ' (' + selectedCount + (isTh ? ' ชนิด, ' : ' species, ') + scenarioWord + ')';

    const highRiskPct = Math.min(48, Math.round(12 + st.settings.forestLoss * 0.9));
    const watershedLabel = isTh ? studyArea.thai : studyArea.name;

    return {
      t, isTh, studyArea,
      langEnActive: st.lang === 'en', langThActive: st.lang === 'th',
      speciesCards, studyAreaOptions, legendSpecies, layerGroups,
      uploads: st.uploads.map(u => {
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
      }),
      dataValidated: st.dataValidated, validNote,
      settings: st.settings, isFuture: st.settings.scenario === 'future',
      isTabBasic: st.settingsTab === 'basic', isTabAdvanced: st.settingsTab === 'advanced', isTabOutput: st.settingsTab === 'output',
      splitNote: st.settings.testSplit + '%', lossNote: st.settings.forestLoss + '%',
      exportFormats, reportGenerated: st.reportGenerated, generatedNote,
      runBtnColor, runBtnLabel, canRunNote, running: st.running, runProgress: st.runProgress,
      lastLogLines: st.log.slice(-3),
      showDistribution: st.mapTab === 'distribution', showCompare: st.mapTab === 'compare',
      mapTab: st.mapTab,
      visiblePoints, modelRun: st.modelRun, notRun: !st.modelRun, highRiskPct, watershedLabel,
      contribBars, responseCurves
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
      ${v.layerGroups.map(g => `
        <div class="group-label">${esc(g.displayName)}</div>
        ${g.items.map(l => `
          <div class="layer-row">
            <div class="layer-top">
              <input value="${esc(l.name)}" data-onchange="layerField" data-id="${l.id}" data-field="name">
              <div class="layer-status" style="color:${l.statusColor}" data-action="toggleLayerStatus" data-id="${l.id}">${esc(l.statusLabel)}</div>
              <div class="layer-remove" data-action="removeLayer" data-id="${l.id}">×</div>
            </div>
            <div class="layer-sub">
              <input class="res-num" type="number" value="${esc(l.resNum)}" data-onchange="layerResolution" data-id="${l.id}">
              <input class="res-unit" value="${esc(l.resUnit)}" data-onchange="layerResolution" data-id="${l.id}">
              <input class="res-source" value="${esc(l.source)}" data-onchange="layerField" data-id="${l.id}" data-field="source">
            </div>
          </div>`).join('')}
      `).join('')}
      <div style="margin-top:6px">
        <div class="btn btn-green" style="width:100%" data-action="useSampleLayers">${esc(t.samples.useSample)}</div>
      </div>
      <div class="geofabrik-note">${esc(t.envLayers.geofabrikNote)} <a href="https://download.geofabrik.de/asia/thailand.html" target="_blank" rel="noopener">thailand-latest.osm.pbf ↗</a></div>
    </div>`;

    html += `<div class="card accent-blue">
      <div class="panel-head"><div class="badge badge-blue">03</div><div class="panel-title">${esc(t.watershed.title)}</div></div>
      ${v.studyAreaOptions.map(a => `
        <div class="area-row ${a.selected ? 'selected' : ''}" data-action="selectStudyArea" data-id="${a.id}">
          <div class="area-name">${esc(a.displayName)}</div>
          <div class="area-meta"><div>${esc(a.watershedClass)}</div><div>${a.areaFmt} km²</div></div>
        </div>`).join('')}
      <div class="btn btn-tan" data-action="useSampleBoundary">${esc(t.samples.useSample)}</div>
    </div>`;

    html += `<div class="card accent-gold">
      <div class="panel-head"><div class="badge badge-gold">04</div><div class="panel-title">${esc(t.settingsPanel.title)}</div></div>
      <div class="tabs3">
        <div class="tab3 ${v.isTabBasic ? 'active' : ''}" data-action="setSettingsTab" data-id="basic">${esc(t.settingsPanel.basic)}</div>
        <div class="tab3 ${v.isTabAdvanced ? 'active' : ''}" data-action="setSettingsTab" data-id="advanced">${esc(t.settingsPanel.advanced)}</div>
        <div class="tab3 ${v.isTabOutput ? 'active' : ''}" data-action="setSettingsTab" data-id="output">${esc(t.settingsPanel.output)}</div>
      </div>
      ${v.isTabBasic ? `
        <div class="field-row">
          <div class="field-label-row"><div>${esc(t.settingsPanel.testSplit)}</div><div>${esc(v.splitNote)}</div></div>
          <input type="range" min="10" max="40" value="${v.settings.testSplit}" data-onchange="setting" data-field="testSplit">
        </div>
        <div class="field-row" style="margin-bottom:0">
          <div class="field-label-row"><div>${esc(t.settingsPanel.replicates)}</div><div>${v.settings.replicates}</div></div>
          <input type="range" min="1" max="10" value="${v.settings.replicates}" data-onchange="setting" data-field="replicates">
        </div>` : ''}
      ${v.isTabAdvanced ? `
        <div class="field-row">
          <div class="field-label-row" style="margin-bottom:5px"><div>${esc(t.settings.resolution)}</div></div>
          <select data-onchange="setting" data-field="resolution">
            <option value="30" ${v.settings.resolution === '30' ? 'selected' : ''}>${esc(t.settings.res30)}</option>
            <option value="100" ${v.settings.resolution === '100' ? 'selected' : ''}>${esc(t.settings.res100)}</option>
            <option value="1000" ${v.settings.resolution === '1000' ? 'selected' : ''}>${esc(t.settings.res1000)}</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field-label-row"><div>${esc(t.settings.reg)}</div><div>${v.settings.regularization}</div></div>
          <input type="range" min="0.1" max="3" step="0.1" value="${v.settings.regularization}" data-onchange="setting" data-field="regularization">
        </div>
        <div class="field-row" style="margin-bottom:${v.isFuture ? '12px' : '0'}">
          <div class="field-label-row" style="margin-bottom:5px"><div>${esc(t.settings.scenario)}</div></div>
          <select data-onchange="setting" data-field="scenario">
            <option value="current" ${v.settings.scenario === 'current' ? 'selected' : ''}>${esc(t.settings.scenarioCurrent)}</option>
            <option value="future" ${v.settings.scenario === 'future' ? 'selected' : ''}>${esc(t.settings.scenarioFuture)}</option>
          </select>
        </div>
        ${v.isFuture ? `
        <div class="future-box">
          <div class="field-label-row"><div>${esc(t.settings.loss)}</div><div>${esc(v.lossNote)}</div></div>
          <input type="range" min="0" max="60" value="${v.settings.forestLoss}" data-onchange="setting" data-field="forestLoss">
        </div>` : ''}` : ''}
      ${v.isTabOutput ? `
        ${v.exportFormats.map(f => `
          <div class="export-row" data-action="toggleExport" data-id="${f.key}">
            <div class="export-swatch" style="background:${f.bg}"></div>
            <div class="export-label">${esc(f.label)}</div>
          </div>`).join('')}
        <div class="btn btn-green" style="margin-top:4px" data-action="generateReport">${esc(t.exportScreen.generate)}</div>
        ${v.reportGenerated ? `<div class="generated-note">${esc(v.generatedNote)}</div>` : ''}` : ''}
    </div>`;

    html += `<div class="run-btn" style="background:${v.runBtnColor}" data-action="runModel">▶ ${esc(v.runBtnLabel)}</div>
      <div class="run-note">${esc(v.canRunNote)}</div>
      ${v.running ? `
        <div class="run-log">
          <div class="run-log-bar"><div style="width:${v.runProgress}%"></div></div>
          <div class="run-log-lines">${v.lastLogLines.map(line => `<div>› ${esc(line)}</div>`).join('')}</div>
        </div>` : ''}`;

    document.getElementById('colLeft').innerHTML = html;
  }

  function renderRightCol(v) {
    const t = v.t;
    let html = '';

    html += `<div class="card accent-orange">
      <div class="panel-head"><div class="badge badge-orange">06</div><div class="panel-title">${esc(t.results.title)}</div></div>
      ${v.notRun ? `<div class="results-empty">${esc(t.results.noResults)}</div>` : `<div class="results-summary">${esc(t.suitability.mean)} <b style="color:#23281f">0.78</b></div>`}
    </div>`;

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

    document.getElementById('colRight').innerHTML = html;
  }

  function renderMapChrome(v) {
    const t = v.t;
    document.getElementById('mapPanelTitle').textContent = t.mapPanel.title;
    document.getElementById('mapTabDist').textContent = t.mapPanel.distribution;
    document.getElementById('mapTabDist').classList.toggle('active', v.showDistribution);
    document.getElementById('mapTabCompare').textContent = t.mapPanel.compare;
    document.getElementById('mapTabCompare').classList.toggle('active', v.showCompare);
    document.getElementById('mapRealNote').textContent = t.map.realNote;

    const noResultsBox = document.getElementById('noResultsBox');
    const showNoResults = v.showCompare && v.notRun;
    noResultsBox.style.display = showNoResults ? 'block' : 'none';
    noResultsBox.textContent = t.results.noResults;
    document.getElementById('leafletMap').style.display = showNoResults ? 'none' : 'block';

    const gradientEl = document.getElementById('mapGradient');
    const scaleLabelsEl = document.getElementById('mapScaleLabels');
    const speciesLegendEl = document.getElementById('mapLegendSpecies');
    const riskNoteEl = document.getElementById('mapRiskNote');

    if (v.showDistribution) {
      gradientEl.style.display = 'none';
      scaleLabelsEl.style.display = 'none';
      riskNoteEl.style.display = 'none';
      speciesLegendEl.innerHTML = v.legendSpecies.map(l => `
        <div class="legend-item"><div class="legend-dot" style="background:${l.color}"></div>${esc(l.displayName)}</div>`).join('');
    } else if (v.showCompare && v.modelRun) {
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
      speciesLegendEl.innerHTML = '';
    }
  }

  // --- Leaflet map: a single persistent map instance, updated in place so it
  // never gets torn down by the innerHTML re-renders above. ---
  let map, boundaryLayer, pointsLayer, lastFittedArea = null;

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

  function riskColor(pct) {
    if (pct < 25) return '#6ea55a';
    if (pct < 38) return '#d9a441';
    return '#c1573a';
  }

  function updateLeafletLayers(v) {
    if (!map || !state.boundaries) return;

    const feature = state.boundaries.features.find(f => f.properties.id === state.studyArea);

    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
    pointsLayer.clearLayers();

    if (v.showCompare && v.notRun) return;

    if (feature) {
      const fillColor = (v.showCompare && v.modelRun) ? riskColor(v.highRiskPct) : '#4f7942';
      boundaryLayer = L.geoJSON(feature, {
        style: { color: '#182620', weight: 2, fillColor, fillOpacity: v.showCompare ? 0.45 : 0.12 }
      }).addTo(map);
      boundaryLayer.bindPopup(`<strong>${esc(v.watershedLabel)}</strong>`);
      if (lastFittedArea !== state.studyArea) {
        map.fitBounds(boundaryLayer.getBounds(), { padding: [12, 12] });
        lastFittedArea = state.studyArea;
      }
    }

    if (v.showDistribution) {
      v.visiblePoints.forEach(pt => {
        L.circleMarker(pt.latlng, {
          radius: 4, color: '#ffffff', weight: 1, fillColor: pt.color, fillOpacity: 0.9
        }).bindPopup(esc(pt.species)).addTo(pointsLayer);
      });
    }
  }

  function render() {
    const v = computeVals();
    renderTop(v);
    renderLeftCol(v);
    renderRightCol(v);
    renderMapChrome(v);
    updateLeafletLayers(v);
  }

  function boot() {
    initMap();
    render();
    fetch('./assets/watersheds.json')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load watershed boundaries');
        return r.json();
      })
      .then(geo => { state.boundaries = geo; render(); })
      .catch(err => console.error(err));
  }

  boot();
})();
