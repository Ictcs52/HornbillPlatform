// HornbillCast species-level map comparison engine.
// Current = real GBIF occurrence points (owned by app.js)
// Scenario = projected suitable-location points after the last Run
// Change = sampled Stable/Gain/Loss cells + projected points + centroid shift arrows
(function () {
  'use strict';

  const CFG = {
    seed: 2569,
    thinDeg: 0.025,
    backgroundN: 900,
    minPresence: 20,
    gridStep: 2,
    fit: { lr: 0.22, iters: 200, l2: 0.025 },
    paths: {
      temp: './assets/rasters/mean_temp_annual_tmd_1991-2020.tif',
      rainfall: './assets/rasters/rainfall_annual_tmd_1991-2020.tif',
      dust: './assets/rasters/pm25_regional_2014-2024.tif',
      forest: './assets/rasters/forest_cover_2025_hansen.tif'
    }
  };

  const E = {
    map: null,
    rasters: null,
    models: [],
    applied: { year: 2025, temp: 0, rainfall: 0, dust: 0 },
    grids: null,
    mode: 'current',
    ready: false,
    running: false,
    projectedLayer: null,
    changeLayer: null,
    arrowLayer: null,
    refreshTimer: null
  };

  // species-analysis.js loads before app.js, so capture the real Prediction Map.
  const originalLMap = L.map.bind(L);
  L.map = function (id, options) {
    const m = originalLMap(id, options);
    if (id === 'leafletMap') E.map = m;
    return m;
  };

  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(s).length; i++) {
      h ^= String(s).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sigmoid(z) { return z > 35 ? 1 : z < -35 ? 0 : 1 / (1 + Math.exp(-z)); }

  function pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  function inThailand(lat, lon) {
    const g = THAILAND_BOUNDARY && THAILAND_BOUNDARY.type === 'Feature' ? THAILAND_BOUNDARY.geometry : THAILAND_BOUNDARY;
    if (!g) return true;
    if (g.type === 'Polygon') {
      if (!pointInRing(lat, lon, g.coordinates[0])) return false;
      for (let i = 1; i < g.coordinates.length; i++) if (pointInRing(lat, lon, g.coordinates[i])) return false;
      return true;
    }
    if (g.type === 'MultiPolygon') return g.coordinates.some(poly => {
      if (!pointInRing(lat, lon, poly[0])) return false;
      for (let i = 1; i < poly.length; i++) if (pointInRing(lat, lon, poly[i])) return false;
      return true;
    });
    return true;
  }

  function selectedIds() {
    if (window.HORNBILL_SELECTION_API && typeof window.HORNBILL_SELECTION_API.selectedIds === 'function') {
      return new Set(window.HORNBILL_SELECTION_API.selectedIds());
    }
    const rows = Array.from(document.querySelectorAll('.species-row[data-id]'));
    if (!rows.length) return new Set(SPECIES.map(s => s.id));
    return new Set(rows.filter(el => parseFloat(el.style.opacity || '1') > 0.75).map(el => el.dataset.id));
  }

  function cleanPoints(sp) {
    const seen = new Set(), cells = new Set(), out = [];
    (sp.points || []).forEach(p => {
      if (!Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1]) || !inThailand(p[0], p[1])) return;
      const exact = Number(p[0]).toFixed(6) + ',' + Number(p[1]).toFixed(6);
      if (seen.has(exact)) return;
      seen.add(exact);
      const cell = Math.floor(p[0] / CFG.thinDeg) + ':' + Math.floor(p[1] / CFG.thinDeg);
      if (cells.has(cell)) return;
      cells.add(cell);
      out.push(p);
    });
    return out;
  }

  function samplePredictors(lat, lon) {
    if (!E.rasters) return null;
    const row = [];
    for (const id of ['temp', 'rainfall', 'dust', 'forest']) {
      const v = sampleRasterAt(E.rasters[id], lat, lon);
      if (v === null || !isFinite(v)) return null;
      row.push(v);
    }
    return row;
  }
  function stats(rows) {
    return rows[0].map((_, j) => {
      const vals = rows.map(r => r[j]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
      return { mean, std: Math.sqrt(variance) || 1 };
    });
  }
  function zrow(st, row) { return row.map((v, j) => (v - st[j].mean) / st[j].std); }
  function fitLogistic(X, y) {
    const w = new Array(X[0].length).fill(0); let b = 0;
    for (let it = 0; it < CFG.fit.iters; it++) {
      const gw = new Array(w.length).fill(0); let gb = 0;
      for (let i = 0; i < X.length; i++) {
        let s = b;
        for (let j = 0; j < w.length; j++) s += w[j] * X[i][j];
        const e = sigmoid(s) - y[i];
        for (let j = 0; j < w.length; j++) gw[j] += e * X[i][j];
        gb += e;
      }
      for (let j = 0; j < w.length; j++) w[j] -= CFG.fit.lr * (gw[j] / X.length + CFG.fit.l2 * w[j]);
      b -= CFG.fit.lr * gb / X.length;
    }
    return { w, b };
  }
  function predict(model, row) {
    let s = model.b;
    for (let j = 0; j < row.length; j++) s += model.w[j] * row[j];
    return sigmoid(s);
  }
  function threshold(scores, y) {
    let best = { t: 0.5, j: -9 };
    for (let t = 0.15; t <= 0.85; t += 0.01) {
      let tp = 0, fn = 0, tn = 0, fp = 0;
      y.forEach((v, i) => v ? (scores[i] >= t ? tp++ : fn++) : (scores[i] >= t ? fp++ : tn++));
      const j = tp / (tp + fn || 1) + tn / (tn + fp || 1) - 1;
      if (j > best.j) best = { t, j };
    }
    return best.t;
  }
  function background(pres, seed) {
    const R = rng(seed), ref = E.rasters.temp, [w, s, e, n] = ref.bbox;
    const used = new Set(pres.map(p => Math.floor(p[0] / CFG.thinDeg) + ':' + Math.floor(p[1] / CFG.thinDeg)));
    const out = []; let tries = 0;
    while (out.length < CFG.backgroundN && tries++ < CFG.backgroundN * 60) {
      const lat = s + R() * (n - s), lon = w + R() * (e - w);
      const k = Math.floor(lat / CFG.thinDeg) + ':' + Math.floor(lon / CFG.thinDeg);
      if (used.has(k) || !inThailand(lat, lon)) continue;
      const row = samplePredictors(lat, lon);
      if (!row) continue;
      used.add(k); out.push(row);
    }
    return out;
  }
  function fitSpecies(sp, index) {
    const points = cleanPoints(sp), px = [];
    points.forEach(p => { const r = samplePredictors(p[0], p[1]); if (r) px.push(r); });
    if (px.length < CFG.minPresence) return null;
    const bg = background(points, (CFG.seed + hashString(sp.id || index)) >>> 0);
    if (bg.length < CFG.minPresence) return null;
    const raw = px.concat(bg), st = stats(raw);
    const X = px.map(r => zrow(st, r)).concat(bg.map(r => zrow(st, r)));
    const y = new Array(px.length).fill(1).concat(new Array(bg.length).fill(0));
    const model = fitLogistic(X, y), scores = X.map(r => predict(model, r));
    return { sp, st, model, threshold: threshold(scores, y) };
  }

  function currentScenario() {
    if (window.HORNBILL_SCENARIO_API && typeof window.HORNBILL_SCENARIO_API.deltas === 'function') {
      const d = window.HORNBILL_SCENARIO_API.deltas();
      const year = window.HORNBILL_SCENARIO_API.currentYear ? window.HORNBILL_SCENARIO_API.currentYear() : 2025;
      return { year: Number(year) || 2025, temp: Number(d.temp) || 0, rainfall: Number(d.rainfall) || 0, dust: Number(d.dust) || 0 };
    }
    return { year: 2025, temp: 0, rainfall: 0, dust: 0 };
  }
  function predictPair(m, lat, lon, deltas) {
    const cur = samplePredictors(lat, lon); if (!cur) return null;
    const fut = [cur[0] + deltas.temp, cur[1] + deltas.rainfall, cur[2] + deltas.dust, cur[3]];
    return {
      current: predict(m.model, zrow(m.st, cur)),
      future: predict(m.model, zrow(m.st, fut))
    };
  }

  async function loadRasters() {
    const out = {};
    for (const [id, url] of Object.entries(CFG.paths)) out[id] = await fetchGeoTiff(url, url.split('/').pop());
    return out;
  }

  function buildGrids(deltas) {
    const ids = selectedIds();
    const models = E.models.filter(m => ids.has(m.sp.id));
    const ref = E.rasters.temp, [w, s, e, n] = ref.bbox;
    const speciesData = {};
    models.forEach(m => speciesData[m.sp.id] = { model: m, cur: [], fut: [], curCount: 0, futCount: 0 });
    const changeCells = [];
    const step = CFG.gridStep;

    for (let row = 0; row < ref.height; row += step) {
      const lat = n - (row + 0.5) / ref.height * (n - s);
      for (let col = 0; col < ref.width; col += step) {
        const lon = w + (col + 0.5) / ref.width * (e - w);
        if (!inThailand(lat, lon)) continue;
        let curRich = 0, futRich = 0;
        for (const m of models) {
          const p = predictPair(m, lat, lon, deltas); if (!p) continue;
          const sd = speciesData[m.sp.id];
          if (p.current >= m.threshold) {
            curRich++; sd.curCount++; sd.cur.push([lat, lon, p.current]);
          }
          const futureScore = deltas.year === 2025 ? p.current : p.future;
          if (futureScore >= m.threshold) {
            futRich++; sd.futCount++; sd.fut.push([lat, lon, futureScore]);
          }
        }
        if (curRich || futRich) changeCells.push([lat, lon, curRich, futRich]);
      }
    }
    E.grids = { deltas: { ...deltas }, speciesData, changeCells, maxSpecies: Math.max(1, models.length) };
  }

  function ensurePanes() {
    if (!E.map) return;
    const specs = [
      ['changePointPane', 640],
      ['projectedPointPane', 690],
      ['shiftArrowPane', 710]
    ];
    specs.forEach(([name, z]) => {
      if (!E.map.getPane(name)) {
        const p = E.map.createPane(name); p.style.zIndex = z; p.style.pointerEvents = 'auto';
      }
    });
  }
  function clearLayer(key) {
    const layer = E[key];
    if (E.map && layer && E.map.hasLayer(layer)) E.map.removeLayer(layer);
    E[key] = null;
  }
  function clearModelLayers() {
    clearLayer('projectedLayer');
    clearLayer('changeLayer');
    clearLayer('arrowLayer');
  }
  function setOccurrences(visible) {
    if (window.HORNBILL_MAP_API && typeof window.HORNBILL_MAP_API.setOccurrenceVisible === 'function') {
      window.HORNBILL_MAP_API.setOccurrenceVisible(visible);
    }
  }

  function spacedTop(cells, target) {
    if (!cells || !cells.length || target <= 0) return [];
    const ranked = cells.slice().sort((a, b) => b[2] - a[2]);
    const out = [], minDist = 0.18;
    for (const p of ranked) {
      if (out.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= minDist)) out.push(p);
      if (out.length >= target) break;
    }
    if (out.length < target) {
      for (const p of ranked) {
        if (!out.includes(p)) out.push(p);
        if (out.length >= target) break;
      }
    }
    return out;
  }
  function drawProjected() {
    clearLayer('projectedLayer');
    if (!E.map || !E.grids || E.grids.deltas.year === 2025) return;
    ensurePanes();
    const group = L.layerGroup();
    const th = document.getElementById('langThBtn')?.classList.contains('active');
    Object.values(E.grids.speciesData).forEach(sd => {
      const m = sd.model;
      const base = Math.max(10, Math.min(55, Math.round(Math.sqrt(Math.max(1, cleanPoints(m.sp).length)) * 3)));
      const ratio = sd.curCount ? sd.futCount / sd.curCount : 0;
      const target = Math.max(0, Math.min(120, Math.round(base * Math.max(0, Math.min(3, ratio)))));
      spacedTop(sd.fut, target).forEach(p => {
        L.circleMarker([p[0], p[1]], {
          pane: 'projectedPointPane', radius: 5.5,
          color: '#f2c230', weight: 3,
          fillColor: m.sp.color || '#333', fillOpacity: 0.95
        }).bindTooltip((th ? m.sp.thai : m.sp.common) + ' — ' + (th ? 'ตำแหน่งพื้นที่เหมาะสมที่คาดการณ์' : 'projected suitable location') + ' (HSI ' + p[2].toFixed(2) + ')')
          .addTo(group);
      });
    });
    group.addTo(E.map); E.projectedLayer = group;
  }

  function sampleEven(arr, max) {
    if (arr.length <= max) return arr;
    const out = [];
    for (let i = 0; i < max; i++) out.push(arr[Math.floor((i + 0.5) * arr.length / max)]);
    return out;
  }
  function drawChangePoints() {
    clearLayer('changeLayer');
    if (!E.map || !E.grids || E.grids.deltas.year === 2025) return;
    ensurePanes();
    const stable = [], gain = [], loss = [];
    E.grids.changeCells.forEach(c => {
      const d = c[3] - c[2];
      if (d > 0) gain.push(c);
      else if (d < 0) loss.push(c);
      else stable.push(c);
    });
    const group = L.layerGroup();
    const add = (cells, fill, name, max) => sampleEven(cells, max).forEach(p => {
      L.circleMarker([p[0], p[1]], {
        pane: 'changePointPane', radius: name === 'Stable' ? 3 : 4,
        color: '#ffffff', weight: 1,
        fillColor: fill, fillOpacity: name === 'Stable' ? 0.58 : 0.88
      }).bindTooltip(name + ': ' + p[2] + ' → ' + p[3] + ' suitable species').addTo(group);
    });
    add(stable, '#4d749c', 'Stable', 180);
    add(gain, '#37915c', 'Gain', 260);
    add(loss, '#c14c3b', 'Loss', 260);
    group.addTo(E.map); E.changeLayer = group;
  }

  function centroid(cells) {
    if (!cells || !cells.length) return null;
    let sw = 0, lat = 0, lon = 0;
    cells.forEach(p => { const w = Math.max(0.01, p[2]); sw += w; lat += p[0] * w; lon += p[1] * w; });
    return sw ? { lat: lat / sw, lon: lon / sw } : null;
  }
  function drawArrows() {
    clearLayer('arrowLayer');
    if (!E.map || !E.grids || E.grids.deltas.year === 2025) return;
    ensurePanes();
    const group = L.layerGroup();
    Object.values(E.grids.speciesData).forEach(sd => {
      const a = centroid(sd.cur), b = centroid(sd.fut); if (!a || !b) return;
      const color = sd.model.sp.color || '#333';
      const line = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
        pane: 'shiftArrowPane', color, weight: 2.5, opacity: 0.95, dashArray: '7,5'
      }).addTo(group);
      const ang = Math.atan2(b.lat - a.lat, (b.lon - a.lon) * Math.cos(b.lat * Math.PI / 180));
      const len = 0.18, spread = 0.55, cc = Math.max(0.2, Math.cos(b.lat * Math.PI / 180));
      const p1 = [b.lat - len * Math.sin(ang - spread), b.lon - len * Math.cos(ang - spread) / cc];
      const p2 = [b.lat - len * Math.sin(ang + spread), b.lon - len * Math.cos(ang + spread) / cc];
      L.polyline([p1, [b.lat, b.lon], p2], { pane: 'shiftArrowPane', color, weight: 2.5, opacity: 0.95 }).addTo(group);
      line.bindTooltip(sd.model.sp.common + ': suitable-area centroid shift');
    });
    group.addTo(E.map); E.arrowLayer = group;
  }

  function activeMainTab() {
    if (document.getElementById('mapTabRainfall')?.classList.contains('active')) return 'rainfall';
    if (document.getElementById('mapTabTemperature')?.classList.contains('active')) return 'temperature';
    if (document.getElementById('mapTabDust')?.classList.contains('active')) return 'dust';
    return 'distribution';
  }

  function ensureBar() {
    const mapEl = document.getElementById('leafletMap');
    if (!mapEl || !mapEl.parentElement) return null;
    let bar = document.getElementById('habitatCompareBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'habitatCompareBar';
      bar.className = 'habitat-compare-bar';
      bar.innerHTML = '<button data-mode="current">Current</button><button data-mode="scenario">Scenario</button><button data-mode="change">Change</button><strong id="habitatModeLabel"></strong><div id="habitatCompareLegend"><span><i class="stable"></i>Stable</span><span><i class="gain"></i>Gain</span><span><i class="loss"></i>Loss</span><span><i class="projected"></i>Projected</span></div>';
      mapEl.parentElement.insertBefore(bar, mapEl);
      bar.addEventListener('click', e => {
        const btn = e.target.closest('button[data-mode]'); if (!btn) return;
        if (activeMainTab() !== 'distribution') {
          const tab = document.getElementById('mapTabDist'); if (tab) tab.click();
          setTimeout(() => { E.mode = btn.dataset.mode; renderView(); }, 60);
        } else {
          E.mode = btn.dataset.mode; renderView();
        }
      });
      if (!document.getElementById('habitatCompareCss')) {
        const st = document.createElement('style'); st.id = 'habitatCompareCss';
        st.textContent = '.habitat-compare-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;margin:0 0 6px;background:#f7f3e8;border:1px solid #e7e0cf;border-radius:6px}.habitat-compare-bar button{border:0;border-radius:4px;padding:6px 12px;font:600 11px sans-serif;background:#eee9dc;color:#5c6256;cursor:pointer}.habitat-compare-bar button.active{background:#287f83;color:#fff}#habitatModeLabel{font:700 10px sans-serif;color:#287f83;margin-left:3px}#habitatCompareLegend{display:none;align-items:center;gap:8px;margin-left:auto;font:600 10px sans-serif;color:#444}#habitatCompareLegend span{display:flex;align-items:center;gap:3px}#habitatCompareLegend i{display:inline-block;width:9px;height:9px;border-radius:50%}.stable{background:#4d749c}.gain{background:#37915c}.loss{background:#c14c3b}.projected{background:#37915c;border:3px solid #f2c230;box-sizing:content-box}';
        document.head.appendChild(st);
      }
    }
    return bar;
  }

  function updateBar() {
    const bar = ensureBar(); if (!bar) return;
    bar.style.display = 'flex';
    bar.querySelectorAll('button[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === E.mode));
    const label = bar.querySelector('#habitatModeLabel'); if (label) label.textContent = E.mode.toUpperCase();
    const legend = bar.querySelector('#habitatCompareLegend'); if (legend) legend.style.display = E.mode === 'change' ? 'flex' : 'none';
  }
  function updateNote() {
    const n = document.getElementById('mapRealNote'); if (!n || activeMainTab() !== 'distribution') return;
    if (E.mode === 'current') n.textContent = 'Current: real GBIF occurrence points.';
    else if (E.mode === 'scenario') n.innerHTML = 'Scenario: <b style="color:#b58a00">yellow-ring points</b> are projected suitable locations after the last Run; they are not bird counts.';
    else n.innerHTML = 'Change: <b style="color:#4d749c">blue = stable</b> · <b style="color:#37915c">green = gain</b> · <b style="color:#c14c3b">red = loss</b>. Yellow-ring points are projected suitable locations; dashed arrows show centroid shift.';
  }

  function renderView() {
    updateBar();
    if (!E.map || activeMainTab() !== 'distribution') return;
    clearModelLayers();
    if (!E.ready || !E.grids || E.grids.deltas.year === 2025 || E.mode === 'current') {
      setOccurrences(true);
      E.mode = 'current';
      updateBar(); updateNote();
      return;
    }
    if (E.mode === 'scenario') {
      setOccurrences(false);
      drawProjected();
    } else if (E.mode === 'change') {
      setOccurrences(false);
      drawChangePoints();
      drawProjected();
      drawArrows();
    }
    updateBar(); updateNote();
  }

  async function runEngine(forceBaseline) {
    if (E.running) return;
    E.running = true;
    try {
      if (!E.rasters) E.rasters = await loadRasters();
      if (!E.models.length) {
        for (let i = 0; i < SPECIES.length; i++) {
          const m = fitSpecies(SPECIES[i], i); if (m) E.models.push(m);
        }
      }
      const d = forceBaseline ? { year: 2025, temp: 0, rainfall: 0, dust: 0 } : currentScenario();
      E.applied = { ...d };
      buildGrids(E.applied);
      E.ready = true;
      E.mode = E.applied.year === 2025 ? 'current' : 'scenario';
      renderView();
      setTimeout(renderView, 900);
      setTimeout(renderView, 2600);
    } catch (err) {
      console.error('Species habitat engine failed:', err);
    } finally {
      E.running = false;
    }
  }

  function scheduleRender(delay) {
    clearTimeout(E.refreshTimer);
    E.refreshTimer = setTimeout(renderView, delay == null ? 80 : delay);
  }

  window.HORNBILL_SPECIES_MAPS = {
    refresh: delay => scheduleRender(delay),
    run: () => runEngine(false)
  };

  document.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'runModel') setTimeout(() => runEngine(false), 520);
    if (action === 'setMapTab') setTimeout(renderView, 100);
    if (action === 'toggleSpecies') {
      setTimeout(() => {
        if (E.ready) { buildGrids(E.applied); renderView(); }
      }, 120);
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('select[data-field="targetYear"]')) {
      const year = Number(el.value);
      clearModelLayers();
      setOccurrences(true);
      E.mode = 'current';
      updateBar(); updateNote();
      if (year === 2025) setTimeout(() => runEngine(true), 120);
      // Future-year numeric edits are drafts and are not calculated until Run.
    }
  });

  const observer = new MutationObserver(() => {
    ensureBar();
    if (E.ready) scheduleRender(100);
  });

  document.addEventListener('DOMContentLoaded', () => {
    ensureBar();
    const app = document.getElementById('app');
    if (app) observer.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    setTimeout(() => runEngine(true), 350);
  });
})();
