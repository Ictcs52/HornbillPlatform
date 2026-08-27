// Keep Current / Scenario / Change global across both maps without forcing the
// Prediction Map back to Hornbill Distribution. This bridge loads before app.js
// so it can capture both Leaflet map instances while preserving the existing
// species-analysis.js wrapper.
(function () {
  'use strict';

  let mainMap = null;
  let forestMap = null;
  let forestPointGroup = null;
  let forestCompareGroup = null;
  let tempTabState = null;
  let lastMode = 'current';

  const previousMap = L.map;
  L.map = function (id, options) {
    const map = previousMap(id, options);
    if (id === 'leafletMap') mainMap = map;
    if (id === 'forestRiskMap') forestMap = map;
    return map;
  };

  function isThai() {
    return !!document.getElementById('langThBtn')?.classList.contains('active');
  }

  function activeMainTabId() {
    for (const id of ['mapTabDist', 'mapTabRainfall', 'mapTabTemperature', 'mapTabDust']) {
      if (document.getElementById(id)?.classList.contains('active')) return id;
    }
    return 'mapTabDist';
  }

  function rememberAndPretendDistribution() {
    const activeId = activeMainTabId();
    if (activeId === 'mapTabDist') return false;
    tempTabState = {
      activeId,
      note: document.getElementById('mapRealNote')?.innerHTML || ''
    };
    ['mapTabDist', 'mapTabRainfall', 'mapTabTemperature', 'mapTabDust'].forEach(id => {
      document.getElementById(id)?.classList.remove('active');
    });
    document.getElementById('mapTabDist')?.classList.add('active');
    return true;
  }

  function restoreActualTab() {
    if (!tempTabState) return;
    const saved = tempTabState;
    tempTabState = null;
    ['mapTabDist', 'mapTabRainfall', 'mapTabTemperature', 'mapTabDust'].forEach(id => {
      document.getElementById(id)?.classList.remove('active');
    });
    document.getElementById(saved.activeId)?.classList.add('active');
    const note = document.getElementById('mapRealNote');
    if (note) note.innerHTML = saved.note;
    // Scenario/Change hides occurrence points on the distribution map. When the
    // user is viewing an environmental raster, keep its normal occurrence points.
    if (window.HORNBILL_MAP_API?.setOccurrenceVisible) {
      window.HORNBILL_MAP_API.setOccurrenceVisible(true);
    }
  }

  function findForestPointGroup() {
    if (forestPointGroup) return forestPointGroup;
    if (!forestMap) return null;
    let best = null;
    forestMap.eachLayer(layer => {
      if (!(layer instanceof L.LayerGroup) || layer === forestCompareGroup || layer instanceof L.GeoJSON) return;
      let circles = 0;
      layer.eachLayer(child => { if (child instanceof L.CircleMarker) circles++; });
      if (circles && (!best || circles > best.count)) best = { layer, count: circles };
    });
    forestPointGroup = best ? best.layer : null;
    return forestPointGroup;
  }

  function setForestBasePointsVisible(visible) {
    const group = findForestPointGroup();
    if (!forestMap || !group) return;
    const has = forestMap.hasLayer(group);
    if (visible && !has) group.addTo(forestMap);
    if (!visible && has) forestMap.removeLayer(group);
  }

  function clearForestCompare() {
    if (forestMap && forestCompareGroup && forestMap.hasLayer(forestCompareGroup)) {
      forestMap.removeLayer(forestCompareGroup);
    }
    forestCompareGroup = null;
  }

  function cloneTooltip(source, target) {
    const content = source && source._tooltip && source._tooltip._content;
    if (content) target.bindTooltip(content);
  }

  function copyComparisonLayersToForest(mode) {
    clearForestCompare();
    if (!mainMap || !forestMap || mode === 'current') return;

    const group = L.layerGroup();
    mainMap.eachLayer(layer => {
      const pane = layer && layer.options && layer.options.pane;
      if (layer instanceof L.CircleMarker) {
        const include = mode === 'scenario'
          ? pane === 'projectedPointPane'
          : (pane === 'changePointPane' || pane === 'projectedPointPane');
        if (!include) return;
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
        cloneTooltip(layer, clone);
        clone.addTo(group);
      } else if (mode === 'change' && layer instanceof L.Polyline && pane === 'shiftArrowPane') {
        const o = layer.options || {};
        const clone = L.polyline(layer.getLatLngs(), {
          color: o.color,
          weight: o.weight,
          opacity: o.opacity,
          dashArray: o.dashArray
        });
        cloneTooltip(layer, clone);
        clone.addTo(group);
      }
    });
    group.addTo(forestMap);
    forestCompareGroup = group;
  }

  function removeComparisonLayersFromEnvironmentalMap() {
    if (!mainMap) return;
    const remove = [];
    mainMap.eachLayer(layer => {
      const pane = layer && layer.options && layer.options.pane;
      if (pane === 'changePointPane' || pane === 'projectedPointPane' || pane === 'shiftArrowPane') remove.push(layer);
    });
    remove.forEach(layer => mainMap.removeLayer(layer));
  }

  function modeText(mode, th) {
    if (th) return mode === 'current' ? 'ปัจจุบัน' : mode === 'scenario' ? 'สถานการณ์จำลอง' : 'การเปลี่ยนแปลง';
    return mode === 'current' ? 'Current' : mode === 'scenario' ? 'Scenario' : 'Change';
  }

  function updateForestModeBadge(mode) {
    const wrap = document.getElementById('forestRiskWrap');
    if (!wrap) return;
    let badge = document.getElementById('forestCompareModeBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'forestCompareModeBadge';
      badge.style.cssText = 'position:absolute;top:8px;right:8px;z-index:800;background:rgba(255,253,247,.94);border:1px solid #ded6c3;border-radius:5px;padding:5px 8px;font:700 10px sans-serif;color:#287f83;box-shadow:0 1px 4px rgba(0,0,0,.08);pointer-events:none';
      wrap.appendChild(badge);
    }
    const th = isThai();
    badge.textContent = (th ? 'โหมด: ' : 'Mode: ') + modeText(mode, th);
  }

  function updateForestNote(mode) {
    const note = document.getElementById('forestRiskNote');
    if (!note) return;
    const th = isThai();
    if (mode === 'current') {
      note.textContent = th
        ? 'ปัจจุบัน: แสดงตำแหน่งข้อมูลจริงบนพื้นที่ป่าไม้ พร้อมความเสี่ยงตามตัวแปรที่เลือก'
        : 'Current: observed locations on forest cover, with risk from the selected variable.';
    } else if (mode === 'scenario') {
      note.innerHTML = th
        ? 'สถานการณ์จำลอง: <b style="color:#b58a00">จุดวงเหลือง</b> คือพื้นที่เหมาะสมที่แบบจำลองคาดการณ์หลัง Run บนแผนที่ป่าไม้'
        : 'Scenario: <b style="color:#b58a00">yellow-ring points</b> are projected suitable locations after Run on the forest map.';
    } else {
      note.innerHTML = th
        ? 'การเปลี่ยนแปลงบนพื้นที่ป่าไม้: <b style="color:#4d749c">น้ำเงิน = คงเดิม</b> · <b style="color:#37915c">เขียว = เพิ่มขึ้น</b> · <b style="color:#c14c3b">แดง = ลดลง</b> · วงเหลือง = จุดคาดการณ์'
        : 'Forest habitat change: <b style="color:#4d749c">blue = stable</b> · <b style="color:#37915c">green = gain</b> · <b style="color:#c14c3b">red = loss</b> · yellow ring = projected.';
    }
  }

  function syncForest(mode) {
    lastMode = mode || lastMode;
    if (!forestMap) return;
    if (lastMode === 'current') {
      clearForestCompare();
      setForestBasePointsVisible(true);
    } else {
      setForestBasePointsVisible(false);
      copyComparisonLayersToForest(lastMode);
    }
    updateForestModeBadge(lastMode);
    updateForestNote(lastMode);
  }

  function translateCompareBar() {
    const bar = document.getElementById('habitatCompareBar');
    if (!bar) return;
    const th = isThai();
    const labels = th
      ? { current:'ปัจจุบัน', scenario:'สถานการณ์จำลอง', change:'การเปลี่ยนแปลง' }
      : { current:'Current', scenario:'Scenario', change:'Change' };
    bar.querySelectorAll('button[data-mode]').forEach(btn => {
      btn.textContent = labels[btn.dataset.mode] || btn.dataset.mode;
    });
    const label = bar.querySelector('#habitatModeLabel');
    if (label) label.textContent = (th ? 'โหมด: ' : 'Mode: ') + modeText(lastMode, th);
    const legend = bar.querySelector('#habitatCompareLegend');
    if (legend) {
      const spans = legend.querySelectorAll('span');
      const words = th ? ['คงเดิม','เพิ่มขึ้น','ลดลง','จุดคาดการณ์'] : ['Stable','Gain','Loss','Projected'];
      spans.forEach((s, i) => {
        const iEl = s.querySelector('i');
        s.textContent = '';
        if (iEl) s.appendChild(iEl);
        s.appendChild(document.createTextNode(words[i] || ''));
      });
    }
  }

  // Capture phase: if a compare button is pressed while Rainfall/Temperature/
  // PM2.5 is open, temporarily make species-analysis think Distribution is
  // active. It can update its internal mode without programmatically clicking
  // the Distribution tab, so the visible environmental tab never jumps.
  document.addEventListener('click', e => {
    const btn = e.target.closest('#habitatCompareBar button[data-mode]');
    if (!btn) return;
    lastMode = btn.dataset.mode;
    rememberAndPretendDistribution();
  }, true);

  // Bubble phase runs after species-analysis has rendered the requested mode.
  // Clone the exact same comparison geometry onto the forest map, then restore
  // the user's actual Prediction Map tab before the browser paints.
  document.addEventListener('click', e => {
    const btn = e.target.closest('#habitatCompareBar button[data-mode]');
    if (btn) {
      syncForest(btn.dataset.mode);
      if (tempTabState) {
        removeComparisonLayersFromEnvironmentalMap();
        restoreActualTab();
      }
      translateCompareBar();
      return;
    }

    const action = e.target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'setForestRiskTab' || action === 'setLang' || action === 'toggleSpecies') {
      setTimeout(() => { translateCompareBar(); syncForest(lastMode); }, 120);
    }
    if (action === 'setMapTab') {
      // Do not alter the selected map tab. Only refresh the lower comparison.
      setTimeout(() => syncForest(lastMode), 100);
    }
  });

  // species-analysis changes the active compare button after Run/year changes.
  // Observe that state so the lower map follows automatically as well.
  const observer = new MutationObserver(() => {
    const bar = document.getElementById('habitatCompareBar');
    if (!bar) return;
    const active = bar.querySelector('button[data-mode].active');
    if (active && active.dataset.mode !== lastMode) {
      lastMode = active.dataset.mode;
      syncForest(lastMode);
    }
    translateCompareBar();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    if (app) observer.observe(app, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
    setTimeout(() => {
      const active = document.querySelector('#habitatCompareBar button[data-mode].active');
      if (active) lastMode = active.dataset.mode;
      translateCompareBar();
      syncForest(lastMode);
    }, 900);
  });
})();