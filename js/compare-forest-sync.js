// Synchronize Current / Scenario / Change with BOTH maps without changing the
// Prediction Map tab selected by the user. Loaded before app.js so both Leaflet
// maps can be captured while preserving species-analysis.js.
(function () {
  'use strict';

  let mainMap = null;
  let forestMap = null;
  let forestPointGroup = null;
  let forestCompareGroup = null;
  let temporaryTab = null;
  let lastMode = 'current';
  let lastLanguage = '';

  const previousMap = L.map;
  L.map = function (id, options) {
    const map = previousMap(id, options);
    if (id === 'leafletMap') mainMap = map;
    if (id === 'forestRiskMap') forestMap = map;
    return map;
  };

  const upperTabs = ['mapTabDist', 'mapTabRainfall', 'mapTabTemperature', 'mapTabDust'];

  function isThai() {
    return !!document.getElementById('langThBtn')?.classList.contains('active');
  }

  function activeUpperTab() {
    return upperTabs.find(id => document.getElementById(id)?.classList.contains('active')) || 'mapTabDist';
  }

  // During a compare click from an environmental tab, temporarily let the
  // species engine render its comparison geometry without changing what the
  // user sees. The original tab is restored before paint.
  function pretendDistributionForThisClick() {
    const activeId = activeUpperTab();
    if (activeId === 'mapTabDist') return;
    temporaryTab = {
      id: activeId,
      note: document.getElementById('mapRealNote')?.innerHTML || ''
    };
    upperTabs.forEach(id => document.getElementById(id)?.classList.remove('active'));
    document.getElementById('mapTabDist')?.classList.add('active');
  }

  function restoreUpperTab() {
    if (!temporaryTab) return;
    const saved = temporaryTab;
    temporaryTab = null;
    upperTabs.forEach(id => document.getElementById(id)?.classList.remove('active'));
    document.getElementById(saved.id)?.classList.add('active');
    const note = document.getElementById('mapRealNote');
    if (note) note.innerHTML = saved.note;
    window.HORNBILL_MAP_API?.setOccurrenceVisible?.(true);
  }

  function findForestPointGroup() {
    if (forestPointGroup) return forestPointGroup;
    if (!forestMap) return null;
    let best = null;
    forestMap.eachLayer(layer => {
      if (!(layer instanceof L.LayerGroup) || layer instanceof L.GeoJSON || layer === forestCompareGroup) return;
      let circles = 0;
      layer.eachLayer(child => { if (child instanceof L.CircleMarker) circles++; });
      if (circles && (!best || circles > best.count)) best = { layer, count: circles };
    });
    forestPointGroup = best?.layer || null;
    return forestPointGroup;
  }

  function showForestBasePoints(show) {
    const group = findForestPointGroup();
    if (!forestMap || !group) return;
    const visible = forestMap.hasLayer(group);
    if (show && !visible) group.addTo(forestMap);
    if (!show && visible) forestMap.removeLayer(group);
  }

  function clearForestCompare() {
    if (forestMap && forestCompareGroup && forestMap.hasLayer(forestCompareGroup)) {
      forestMap.removeLayer(forestCompareGroup);
    }
    forestCompareGroup = null;
  }

  function copyTooltip(source, target) {
    const content = source?._tooltip?._content;
    if (content) target.bindTooltip(content);
  }

  // Copy the exact comparison geometry already computed by species-analysis.js
  // to the forest map. No second model fit is performed here.
  function copyComparisonToForest(mode) {
    if (!mainMap || !forestMap || mode === 'current') return false;
    const group = L.layerGroup();
    let copied = 0;

    mainMap.eachLayer(layer => {
      const pane = layer?.options?.pane;

      // Change is now a raster AREA overlay, not hundreds of point markers.
      if (mode === 'change' && layer instanceof L.ImageOverlay && pane === 'changeAreaPane') {
        const url = layer._url;
        const bounds = layer.getBounds?.();
        if (url && bounds) {
          L.imageOverlay(url, bounds, { opacity: layer.options?.opacity ?? 1, interactive: false }).addTo(group);
          copied++;
        }
        return;
      }

      if (layer instanceof L.CircleMarker) {
        const include = pane === 'projectedPointPane';
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
        copyTooltip(layer, clone);
        clone.addTo(group);
        copied++;
      } else if (mode === 'change' && layer instanceof L.Polyline && pane === 'shiftArrowPane') {
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
    forestCompareGroup = group;
    return true;
  }

  function removeComparisonFromUpperEnvironmentalMap() {
    if (!mainMap) return;
    const remove = [];
    mainMap.eachLayer(layer => {
      const pane = layer?.options?.pane;
      if (pane === 'changeAreaPane' || pane === 'projectedPointPane' || pane === 'shiftArrowPane') remove.push(layer);
    });
    remove.forEach(layer => mainMap.removeLayer(layer));
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
    const text = (th ? 'โหมด: ' : 'Mode: ') + modeWord(lastMode, th);
    if (badge.textContent !== text) badge.textContent = text;
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
        ? 'การเปลี่ยนแปลงแสดงเป็น <b>พื้นที่สี</b> บนพื้นที่ป่าไม้: <b style="color:#4d749c">น้ำเงิน = ชนิดเดิมยังเหมาะสม</b> · <b style="color:#37915c">เขียว = เพิ่มขึ้น</b> · <b style="color:#c14c3b">แดง = ลดลง</b> · <b style="color:#8459a2">ม่วง = จำนวนชนิดเท่าเดิมแต่ชนิดเปลี่ยน</b> · วงเหลือง = จุดคาดการณ์'
        : 'Forest habitat change is shown as <b>colored areas</b>: <b style="color:#4d749c">blue = stable species set</b> · <b style="color:#37915c">green = gain</b> · <b style="color:#c14c3b">red = loss</b> · <b style="color:#8459a2">purple = turnover</b> · yellow ring = projected.';
    }
  }

  function syncForest(mode) {
    if (mode) lastMode = mode;
    if (!forestMap) return;

    if (lastMode === 'current') {
      clearForestCompare();
      showForestBasePoints(true);
    } else {
      const copied = copyComparisonToForest(lastMode);
      if (copied || forestCompareGroup) showForestBasePoints(false);
    }
    updateForestBadge();
    updateForestNote();
  }

  function translateCompareBar() {
    const bar = document.getElementById('habitatCompareBar');
    if (!bar) return;
    const th = isThai();
    const lang = th ? 'th' : 'en';
    const names = th
      ? { current:'ปัจจุบัน', scenario:'สถานการณ์จำลอง', change:'การเปลี่ยนแปลง' }
      : { current:'Current', scenario:'Scenario', change:'Change' };

    bar.querySelectorAll('button[data-mode]').forEach(btn => {
      const text = names[btn.dataset.mode] || btn.dataset.mode;
      if (btn.textContent !== text) btn.textContent = text;
    });
    const label = bar.querySelector('#habitatModeLabel');
    const modeLabel = (th ? 'โหมด: ' : 'Mode: ') + modeWord(lastMode, th);
    if (label && label.textContent !== modeLabel) label.textContent = modeLabel;

    if (lastLanguage !== lang) {
      lastLanguage = lang;
      const legend = bar.querySelector('#habitatCompareLegend');
      const words = th
        ? ['คงเดิม','เพิ่มขึ้น','ลดลง','สับเปลี่ยนชนิด','จุดคาดการณ์']
        : ['Stable','Gain','Loss','Turnover','Projected'];
      legend?.querySelectorAll('span').forEach((span, i) => {
        const icon = span.querySelector('i');
        const wanted = words[i] || '';
        const current = span.textContent.trim();
        if (current === wanted) return;
        span.textContent = '';
        if (icon) span.appendChild(icon);
        span.appendChild(document.createTextNode(wanted));
      });
    }
  }

  // Capture phase occurs before the compare bar's own listener.
  document.addEventListener('click', e => {
    const btn = e.target.closest('#habitatCompareBar button[data-mode]');
    if (!btn) return;
    lastMode = btn.dataset.mode;
    pretendDistributionForThisClick();
  }, true);

  // Bubble phase occurs after species-analysis.js rendered the selected mode.
  document.addEventListener('click', e => {
    const btn = e.target.closest('#habitatCompareBar button[data-mode]');
    if (btn) {
      syncForest(btn.dataset.mode);
      if (temporaryTab) {
        removeComparisonFromUpperEnvironmentalMap();
        restoreUpperTab();
      }
      translateCompareBar();
      return;
    }

    const action = e.target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'setForestRiskTab' || action === 'setLang' || action === 'toggleSpecies') {
      setTimeout(() => { translateCompareBar(); syncForest(); }, 140);
    } else if (action === 'setMapTab') {
      setTimeout(() => syncForest(), 100);
    }
  });

  const observer = new MutationObserver(() => {
    const active = document.querySelector('#habitatCompareBar button[data-mode].active');
    if (active && active.dataset.mode !== lastMode) {
      lastMode = active.dataset.mode;
      syncForest();
      translateCompareBar();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    if (app) observer.observe(app, { subtree:true, attributes:true, attributeFilter:['class'] });
    setTimeout(() => {
      const active = document.querySelector('#habitatCompareBar button[data-mode].active');
      if (active) lastMode = active.dataset.mode;
      translateCompareBar();
      syncForest();
    }, 900);
  });
})();