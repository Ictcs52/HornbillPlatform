// Keep environmental raster maps visually independent from Current / Scenario / Change.
// Compare mode still controls Hornbill Distribution and the lower Forest Risk map,
// but Rainfall / Temperature / PM2.5 must retain their original raster colours.
(function () {
  'use strict';

  let mainMap = null;
  const previousMap = L.map;
  L.map = function (id, options) {
    const map = previousMap(id, options);
    if (id === 'leafletMap') mainMap = map;
    return map;
  };

  const ENV_TABS = new Set(['rainfall', 'temperature', 'dust']);
  const COMPARE_PANES = new Set(['changeAreaPane', 'changePointPane', 'projectedPointPane', 'shiftArrowPane']);

  function activeTab() {
    if (document.getElementById('mapTabRainfall')?.classList.contains('active')) return 'rainfall';
    if (document.getElementById('mapTabTemperature')?.classList.contains('active')) return 'temperature';
    if (document.getElementById('mapTabDust')?.classList.contains('active')) return 'dust';
    return 'distribution';
  }

  function removeCompareLayersFromEnvironmentalMap() {
    if (!mainMap || !ENV_TABS.has(activeTab())) return;
    const remove = [];
    mainMap.eachLayer(layer => {
      const pane = layer?.options?.pane;
      if (COMPARE_PANES.has(pane)) remove.push(layer);
    });
    remove.forEach(layer => {
      if (mainMap.hasLayer(layer)) mainMap.removeLayer(layer);
    });
    // Environmental maps should keep the normal occurrence markers, just like before.
    window.HORNBILL_MAP_API?.setOccurrenceVisible?.(true);
  }

  document.addEventListener('click', e => {
    const mapTab = e.target.closest('[data-action="setMapTab"]');
    if (mapTab && ENV_TABS.has(mapTab.getAttribute('data-id'))) {
      // Clear immediately so users never see the Change colours sitting over the raster.
      setTimeout(removeCompareLayersFromEnvironmentalMap, 0);
      setTimeout(removeCompareLayersFromEnvironmentalMap, 80);
      setTimeout(removeCompareLayersFromEnvironmentalMap, 220);
      return;
    }

    // Current / Scenario / Change can still be pressed while an environmental map is open.
    // Keep the selected environmental tab and remove any temporary comparison geometry
    // after the lower Forest Risk map has copied what it needs.
    if (e.target.closest('#habitatCompareBar button[data-mode]')) {
      setTimeout(removeCompareLayersFromEnvironmentalMap, 0);
      setTimeout(removeCompareLayersFromEnvironmentalMap, 80);
      setTimeout(removeCompareLayersFromEnvironmentalMap, 220);
    }
  });

  // app.js and the species engine both update classes asynchronously. Watch the map-tab
  // state and enforce the separation without touching the environmental raster layer.
  const observer = new MutationObserver(() => {
    if (ENV_TABS.has(activeTab())) removeCompareLayersFromEnvironmentalMap();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const tabs = ['mapTabDist', 'mapTabRainfall', 'mapTabTemperature', 'mapTabDust']
      .map(id => document.getElementById(id)).filter(Boolean);
    tabs.forEach(tab => observer.observe(tab, { attributes: true, attributeFilter: ['class'] }));
  });
})();