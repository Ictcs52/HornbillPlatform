// Current / Scenario / Change overlay bridge.
// Environmental maps keep their own rainfall/temperature/PM2.5 raster colors.
// Bird comparison is drawn only as occurrence/projected points and centroid arrows.
// The full Stable/Gain/Loss/Turnover AREA remains limited to Hornbill Distribution
// (and is copied to the lower Forest Cover x Habitat Risk map).
(function () {
  'use strict';

  let mainMap = null;
  let forestMap = null;
  let forestBasePoints = null;
  let forestCompare = null;
  let savedTab = null;
  let lastMode = 'current';
  let lastLanguage = '';

  const previousMap = L.map;
  L.map = function (id, options) {
    const map = previousMap(id, options);
    if (id === 'leafletMap') mainMap = map;
    if (id === 'forestRiskMap') forestMap = map;
    return map;
  };

  const tabs = ['mapTabDist', 'mapTabRainfall', 'mapTabTemperature', 'mapTabDust'];

  function isThai() {
    return !!document.getElementById('langThBtn')?.classList.contains('active');
  }

  function activeTab() {
    return tabs.find(id => document.getElementById(id)?.classList.contains('active')) || 'mapTabDist';
  }

  function isEnvironmentalTab() {
    return activeTab() !== 'mapTabDist';
  }

  // species-analysis.js only renders comparison geometry while it thinks the
  // Distribution tab is active. For an environmental map click, temporarily
  // switch only the active CSS class (not the actual map/raster), let the engine
  // render, then restore the real tab before paint.
  function pretendDistribution() {
    const id = activeTab();
    if (id === 'mapTabDist') return;
    savedTab = {
      id,
      note: document.getElementById('mapRealNote')?.innerHTML || ''
    };
    tabs.forEach(t => document.getElementById(t)?.classList.remove('active'));
    document.getElementById('mapTabDist')?.classList.add('active');
  }

  function restoreTab(mode) {
    if (!savedTab) return;
    const saved = savedTab;
    savedTab = null;
    tabs.forEach(t => document.getElementById(t)?.classList.remove('active'));
    document.getElementById(saved.id)?.classList.add('active');
    const note = document.getElementById('mapRealNote');
    if (note) note.innerHTML = saved.note;

    // Current = observed points. Scenario = projected only.
    // Change on an environmental raster = observed + projected + shift arrows.
    const showObserved = mode === 'current' || mode === 'change';
    window.HORNBILL_MAP_API?.setOccurrenceVisible?.(showObserved);
  }

  function removeUpperChangeAreaOnly() {
    if (!mainMap) return;
    const remove = [];
    mainMap.eachLayer(layer => {
      if (layer?.options?.pane === 'changeAreaPane') remove.push(layer);
    });
    remove.forEach(layer => mainMap.removeLayer(layer));
  }

  function applyEnvironmentalMode(mode) {
    if (!mainMap || !isEnvironmentalTab()) return;
    // Never tint rainfall/temperature/PM2.5 rasters with habitat-change colors.
    removeUpperChangeAreaOnly();
    const showObserved = mode === 'current' || mode === 'change';
    window.HORNBILL_MAP_API?.setOccurrenceVisible?.(showObserved);
  }

  function findForestBasePoints() {
    if (forestBasePoints) return forestBasePoints;
    if (!forestMap) return null;
    let best = null;
    forestMap.eachLayer(layer => {
      if (!(layer instanceof L.LayerGroup) || layer instanceof L.GeoJSON || layer === forestCompare) return;
      let circles = 0;
      layer.eachLayer(child => { if (child instanceof L.CircleMarker) circles++; });
      if (circles && (!best || circles > best.count)) best = { layer, count: circles };
    });
    forestBasePoints = best?.layer || null;
    return forestBasePoints;
  }

  function showForestBase(show) {
    const group = findForestBasePoints();
    if (!forestMap || !group) return;
    const visible = forestMap.hasLayer(group);
    if (show && !visible) group.addTo(forestMap);
    if (!show && visible) forestMap.removeLayer(group);
  }

  function clearForestCompare() {
    if (forestMap && forestCompare && forestMap.hasLayer(forestCompare)) forestMap.removeLayer(forestCompare);
    forestCompare = null;
  }

  function copyTooltip(source, target) {
    const content = source?._tooltip?._content;
    if (content) target.bindTooltip(content);
  }

  // Copy comparison geometry to the lower Forest Risk map. This runs BEFORE the
  // upper environmental map removes its change-area layer, so the lower map can
  // still show the full habitat-change area when Change is selected.
  function copyToForest(mode) {
    if (!mainMap || !forestMap || mode === 'current') return false;
    const group = L.layerGroup();
    let copied = 0;

    mainMap.eachLayer(layer => {
      const pane = layer?.options?.pane;

      if (mode === 'change' && layer instanceof L.ImageOverlay && pane === 'changeAreaPane') {
        const url = layer._url;
        const bounds = layer.getBounds?.();
        if (url && bounds) {
          L.imageOverlay(url, bounds, { opacity: 1, interactive: false }).addTo(group);
          copied++;
        }
        return;
      }

      if (layer instanceof L.CircleMarker && pane === 'projectedPointPane') {
        const o = layer.options || {};
        const clone = L.circleMarker(layer.getLatLng(), {
          radius: o.radius || 4,
          color: o.color,
          weight: o.weight,
          opacity: o.opacity,
          fillColor: o.fillColor,
          fillOpacity: o.fillOpacity,
          dashArray: o.dashArray
        });
        copyTooltip(layer, clone);
        clone.addTo(group);
        copied++;
        return;
      }

      if (mode === 'change' && layer instanceof L.Polyline && pane === 'shiftArrowPane') {
        const o = layer.options || {};
        const clone = L.polyline(layer.getLatLngs(), {
          color: o.color,
          weight: o.weight,
          opacity: o.opacity,
          dashArray: o.dashArray
        });
        copyTooltip(layer, clone);
        clone.addTo(group);
        copied++;
      }
    });

    if (!copied) return false;
    clearForestCompare();
    group.addTo(forestMap);
    forestCompare = group;
    return true;
  }

  function modeWord(mode, th) {
    if (th) return mode === 'current' ? 'ปัจจุบัน' : mode === 'scenario' ? 'สถานการณ์จำลอง' : 'การเปลี่ยนแปลง';
    return mode === 'current' ? 'Current' : mode === 'scenario' ? 'Scenario' : 'Change';
  }

  function updateForestBadge() {
    const wrap = document.getElementById('forestRiskWrap');
    if (!wrap) return;
    let badge = document.getElementById('forestCompareModeBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'forestCompareModeBadge';
      badge.style.cssText = 'position:absolute;top:8px;right:8px;z-index:800;background:rgba(255,253,247,.95);border:1px solid #ded6c3;border-radius:5px;padding:5px 8px;font:700 10px sans-serif;color:#287f83;box-shadow:0 1px 4px rgba(0,0,0,.08);pointer-events:none';
      wrap.appendChild(badge);
    }
    const th = isThai();
    badge.textContent = (th ? 'โหมด: ' : 'Mode: ') + modeWord(lastMode, th);
  }

  function updateForestNote() {
    const note = document.getElementById('forestRiskNote');
    if (!note) return;
    const th = isThai();
    if (lastMode === 'current') {
      note.textContent = th
        ? 'ปัจจุบัน: ตำแหน่งข้อมูลจริงบนพื้นที่ป่าไม้ พร้อมความเสี่ยงตามตัวแปรที่เลือก'
        : 'Current: observed locations on forest cover, with risk from the selected variable.';
    } else if (lastMode === 'scenario') {
      note.innerHTML = th
        ? 'สถานการณ์จำลอง: <b style="color:#b58a00">จุดวงเหลือง</b> คือพื้นที่เหมาะสมที่คาดการณ์หลัง Run บนแผนที่ป่าไม้'
        : 'Scenario: <b style="color:#b58a00">yellow-ring points</b> are projected suitable locations after Run on the forest map.';
    } else {
      note.innerHTML = th
        ? 'การเปลี่ยนแปลงบนพื้นที่ป่าไม้: น้ำเงิน = คงเดิม · เขียว = เพิ่มขึ้น · แดง = ลดลง · ม่วง = สับเปลี่ยนชนิด · วงเหลือง = จุดคาดการณ์'
        : 'Forest habitat change: blue = stable · green = gain · red = loss · purple = turnover · yellow ring = projected.';
    }
  }

  function syncForest(mode) {
    if (mode) lastMode = mode;
    if (!forestMap) return;
    if (lastMode === 'current') {
      clearForestCompare();
      showForestBase(true);
    } else {
      const copied = copyToForest(lastMode);
      if (copied || forestCompare) showForestBase(false);
    }
    updateForestBadge();
    updateForestNote();
  }

  function translateBar() {
    const bar = document.getElementById('habitatCompareBar');
    if (!bar) return;
    const th = isThai();
    const lang = th ? 'th' : 'en';
    const names = th
      ? { current: 'ปัจจุบัน', scenario: 'สถานการณ์จำลอง', change: 'การเปลี่ยนแปลง' }
      : { current: 'Current', scenario: 'Scenario', change: 'Change' };

    bar.querySelectorAll('button[data-mode]').forEach(btn => {
      const wanted = names[btn.dataset.mode] || btn.dataset.mode;
      if (btn.textContent !== wanted) btn.textContent = wanted;
    });
    const label = bar.querySelector('#habitatModeLabel');
    if (label) label.textContent = (th ? 'โหมด: ' : 'Mode: ') + modeWord(lastMode, th);

    const legend = bar.querySelector('#habitatCompareLegend');
    if (legend) {
      // On environmental maps Change shows movement only (points + arrows), so
      // do not advertise Stable/Gain/Loss/Turnover area colors there.
      const spans = Array.from(legend.querySelectorAll('span'));
      spans.slice(0, 4).forEach(s => { s.style.display = (lastMode === 'change' && !isEnvironmentalTab()) ? 'flex' : 'none'; });
      if (spans[4]) spans[4].style.display = lastMode === 'change' ? 'flex' : '';

      if (lastLanguage !== lang) {
        lastLanguage = lang;
        const words = th
          ? ['คงเดิม', 'เพิ่มขึ้น', 'ลดลง', 'สับเปลี่ยนชนิด', 'จุดคาดการณ์']
          : ['Stable', 'Gain', 'Loss', 'Turnover', 'Projected'];
        spans.forEach((span, i) => {
          const icon = span.querySelector('i');
          span.textContent = '';
          if (icon) span.appendChild(icon);
          span.appendChild(document.createTextNode(words[i] || ''));
        });
      }
    }
  }

  // Capture phase: temporarily expose Distribution to species-analysis.js only.
  document.addEventListener('click', e => {
    const btn = e.target.closest('#habitatCompareBar button[data-mode]');
    if (!btn) return;
    lastMode = btn.dataset.mode;
    if (isEnvironmentalTab()) pretendDistribution();
  }, true);

  // Bubble phase: species-analysis.js has now rendered the requested mode.
  document.addEventListener('click', e => {
    const btn = e.target.closest('#habitatCompareBar button[data-mode]');
    if (btn) {
      lastMode = btn.dataset.mode;
      syncForest(lastMode); // copy full Change area first
      if (savedTab) {
        if (lastMode === 'change') removeUpperChangeAreaOnly();
        restoreTab(lastMode);
      }
      applyEnvironmentalMode(lastMode);
      translateBar();
      return;
    }

    const action = e.target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'setMapTab') {
      setTimeout(() => {
        const active = document.querySelector('#habitatCompareBar button[data-mode].active');
        if (active) lastMode = active.dataset.mode;
        applyEnvironmentalMode(lastMode);
        translateBar();
        syncForest(lastMode);
      }, 140);
    } else if (action === 'setForestRiskTab' || action === 'setLang' || action === 'toggleSpecies') {
      setTimeout(() => { translateBar(); syncForest(lastMode); applyEnvironmentalMode(lastMode); }, 160);
    }
  });

  const observer = new MutationObserver(() => {
    const active = document.querySelector('#habitatCompareBar button[data-mode].active');
    if (active && active.dataset.mode !== lastMode) {
      lastMode = active.dataset.mode;
      syncForest(lastMode);
    }
    translateBar();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    if (app) observer.observe(app, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => {
      const active = document.querySelector('#habitatCompareBar button[data-mode].active');
      if (active) lastMode = active.dataset.mode;
      translateBar();
      syncForest(lastMode);
      applyEnvironmentalMode(lastMode);
    }, 900);
  });
})();