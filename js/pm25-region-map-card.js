// Repositions the existing regional PM2.5 summary into the original PM2.5 map
// and keeps text/value colors synchronized with the PM2.5 legend classes.
(function () {
  'use strict';

  function pm25Color(value) {
    if (!isFinite(value)) return '#8a8f80';
    if (typeof classColor === 'function' && typeof RASTER_RAMPS !== 'undefined' && typeof RASTER_CLASSES !== 'undefined') {
      const rgb = classColor(RASTER_RAMPS.dust, RASTER_CLASSES.dust.breaks, value);
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
    // Fallback matches the visible PM2.5 classification used by the map.
    if (value < 15) return '#2b98d1';
    if (value < 25) return '#56ad7d';
    if (value < 37.5) return '#e0b52c';
    if (value < 75) return '#eb6c2e';
    return '#bf1760';
  }

  function recolor(panel) {
    panel.querySelectorAll('.pm25-region-row').forEach(row => {
      const valueEl = row.querySelector('strong');
      const codeEl = row.querySelector('b');
      if (!valueEl) return;
      const value = parseFloat(valueEl.textContent);
      const color = pm25Color(value);
      valueEl.style.color = color;
      valueEl.style.borderColor = color;
      if (codeEl) codeEl.style.color = color;
    });
  }

  function relocate() {
    const panel = document.querySelector('.pm25-region-panel');
    const mapWrap = document.getElementById('mapWrap');
    if (!panel || !mapWrap) return false;

    if (panel.parentElement !== mapWrap) mapWrap.appendChild(panel);
    panel.classList.add('pm25-region-panel-in-map');
    recolor(panel);

    if (!panel.__pm25Observer) {
      const obs = new MutationObserver(() => recolor(panel));
      obs.observe(panel, { childList: true, subtree: true, characterData: true });
      panel.__pm25Observer = obs;
    }
    return true;
  }

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #forestRiskScaleLabels { display:none !important; }
      .map-region-layout { display:block !important; }
      #mapWrap { position:relative !important; }
      .pm25-region-panel.pm25-region-panel-in-map {
        position:absolute !important;
        left:10px !important;
        bottom:10px !important;
        top:auto !important;
        right:auto !important;
        z-index:1150 !important;
        width:225px !important;
        margin:0 !important;
        padding:11px 12px !important;
        background:rgba(255,255,255,.96) !important;
        border:1px solid #d8d2bf !important;
        border-radius:7px !important;
        box-shadow:0 1px 5px rgba(0,0,0,.25) !important;
      }
      .pm25-region-panel-in-map .pm25-region-title { font-size:11.5px; font-weight:700; margin-bottom:8px; }
      .pm25-region-panel-in-map .pm25-region-row {
        display:grid; grid-template-columns:28px 1fr 50px; gap:6px;
        align-items:center; padding:5px 0; border-bottom:1px solid #f0ede1; font-size:10.5px;
      }
      .pm25-region-panel-in-map .pm25-region-row span { color:#5f6558; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pm25-region-panel-in-map .pm25-region-row strong { text-align:center; border:1px solid; border-radius:5px; padding:3px 4px; background:#fff; }
      .pm25-region-panel-in-map .pm25-region-note { font-size:9px; color:#8a8f80; line-height:1.35; margin-top:7px; }
      @media (max-width:760px) {
        .pm25-region-panel.pm25-region-panel-in-map { width:200px !important; left:8px !important; bottom:8px !important; padding:9px !important; }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded', () => {
    addStyles();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (relocate() || attempts > 80) clearInterval(timer);
    }, 100);

    const app = document.getElementById('app');
    if (app) {
      const obs = new MutationObserver(() => relocate());
      obs.observe(app, { childList: true, subtree: true });
    }
  });
})();