// Centered Run feedback overlay. Keeps the student's layout unchanged and only
// appears while app.js is actively running the model.
(function () {
  'use strict';

  let active = false;
  let startedAt = 0;
  let safetyTimer = null;

  function isThai() {
    return !!document.getElementById('langThBtn')?.classList.contains('active');
  }

  function ensureOverlay() {
    let overlay = document.getElementById('modelRunLoading');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'modelRunLoading';
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="model-run-loading-card">
        <div class="model-run-spinner" aria-hidden="true"></div>
        <div id="modelRunLoadingTitle" class="model-run-loading-title"></div>
        <div id="modelRunLoadingStep" class="model-run-loading-step"></div>
        <div class="model-run-loading-track"><div id="modelRunLoadingBar"></div></div>
        <div id="modelRunLoadingPct" class="model-run-loading-pct">0%</div>
      </div>`;
    document.body.appendChild(overlay);

    if (!document.getElementById('modelRunLoadingStyle')) {
      const style = document.createElement('style');
      style.id = 'modelRunLoadingStyle';
      style.textContent = `
        #modelRunLoading{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(35,40,31,.20);backdrop-filter:blur(1px)}
        #modelRunLoading.show{display:flex}
        .model-run-loading-card{width:min(360px,calc(100vw - 40px));background:#fffdf7;border:1px solid #e2dbc9;border-radius:12px;box-shadow:0 16px 44px rgba(35,40,31,.22);padding:22px 24px;text-align:center;color:#23281f}
        .model-run-spinner{width:38px;height:38px;margin:0 auto 12px;border:4px solid #dfe8e4;border-top-color:#287f83;border-radius:50%;animation:modelRunSpin .8s linear infinite}
        @keyframes modelRunSpin{to{transform:rotate(360deg)}}
        .model-run-loading-title{font:700 15px/1.35 sans-serif;margin-bottom:7px}
        .model-run-loading-step{min-height:32px;font:500 11px/1.45 sans-serif;color:#6d7468;margin-bottom:12px}
        .model-run-loading-track{height:7px;background:#ece8dd;border-radius:999px;overflow:hidden}
        .model-run-loading-track>div{height:100%;width:0;background:#287f83;border-radius:999px;transition:width .2s ease}
        .model-run-loading-pct{margin-top:6px;font:700 11px/1 sans-serif;color:#287f83}
      `;
      document.head.appendChild(style);
    }
    return overlay;
  }

  function show() {
    const overlay = ensureOverlay();
    active = true;
    startedAt = Date.now();
    overlay.classList.add('show');
    update();
    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(hide, 20000);
  }

  function hide() {
    active = false;
    clearTimeout(safetyTimer);
    const overlay = document.getElementById('modelRunLoading');
    if (overlay) overlay.classList.remove('show');
  }

  function update() {
    if (!active) return;
    const th = isThai();
    const title = document.getElementById('modelRunLoadingTitle');
    const step = document.getElementById('modelRunLoadingStep');
    const bar = document.getElementById('modelRunLoadingBar');
    const pct = document.getElementById('modelRunLoadingPct');

    if (title) title.textContent = th ? 'กำลังประมวลผลแบบจำลอง' : 'Processing model';

    const progressBar = document.querySelector('.run-log-bar > div');
    const width = progressBar ? (progressBar.style.width || '0%') : '0%';
    const n = Math.max(0, Math.min(100, parseInt(width, 10) || 0));
    if (bar) bar.style.width = n + '%';
    if (pct) pct.textContent = n + '%';

    const lines = Array.from(document.querySelectorAll('.run-log-lines > div'));
    if (step) {
      const current = lines.length ? lines[lines.length - 1].textContent.replace(/^›\s*/, '') : '';
      step.textContent = current || (th ? 'กำลังเตรียมข้อมูลและคำนวณพื้นที่เหมาะสม…' : 'Preparing data and calculating habitat suitability…');
    }
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action="runModel"]');
    if (!btn) return;
    show();
  }, true);

  const observer = new MutationObserver(function () {
    if (!active) return;
    update();
    const runningLog = document.querySelector('.run-log');
    const elapsed = Date.now() - startedAt;
    // app.js removes .run-log when state.running becomes false.
    if (!runningLog && elapsed > 500) hide();
  });

  document.addEventListener('DOMContentLoaded', function () {
    ensureOverlay();
    const app = document.getElementById('app');
    if (app) observer.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
  });
})();