// Centered Run feedback overlay. The main model and the species-map model are
// intentionally run in sequence (see run-coordinator.js), so this overlay shows
// both phases instead of looking frozen on the initial message.
(function () {
  'use strict';

  let active = false;
  let startedAt = 0;
  let phase = 'app';
  let mapPhaseAt = 0;
  let sawRunLog = false;
  let safetyTimer = null;
  let finishTimer = null;
  let pulseTimer = null;

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
        .model-run-loading-card{width:min(380px,calc(100vw - 40px));background:#fffdf7;border:1px solid #e2dbc9;border-radius:12px;box-shadow:0 16px 44px rgba(35,40,31,.22);padding:22px 24px;text-align:center;color:#23281f}
        .model-run-spinner{width:38px;height:38px;margin:0 auto 12px;border:4px solid #dfe8e4;border-top-color:#287f83;border-radius:50%;animation:modelRunSpin .8s linear infinite}
        @keyframes modelRunSpin{to{transform:rotate(360deg)}}
        .model-run-loading-title{font:700 15px/1.35 sans-serif;margin-bottom:7px}
        .model-run-loading-step{min-height:34px;font:500 11px/1.45 sans-serif;color:#6d7468;margin-bottom:12px}
        .model-run-loading-track{height:7px;background:#ece8dd;border-radius:999px;overflow:hidden}
        .model-run-loading-track>div{height:100%;width:0;background:#287f83;border-radius:999px;transition:width .28s ease}
        .model-run-loading-pct{margin-top:6px;font:700 11px/1 sans-serif;color:#287f83}
      `;
      document.head.appendChild(style);
    }
    return overlay;
  }

  function setProgress(n) {
    n = Math.max(0, Math.min(100, Math.round(n)));
    const bar = document.getElementById('modelRunLoadingBar');
    const pct = document.getElementById('modelRunLoadingPct');
    if (bar) bar.style.width = n + '%';
    if (pct) pct.textContent = n + '%';
  }

  function show() {
    const overlay = ensureOverlay();
    active = true;
    startedAt = Date.now();
    phase = 'app';
    mapPhaseAt = 0;
    sawRunLog = false;
    overlay.classList.add('show');
    clearTimeout(safetyTimer);
    clearTimeout(finishTimer);
    clearInterval(pulseTimer);
    setProgress(5);
    update();
    pulseTimer = setInterval(update, 220);
    // Last-resort guard only. Normal completion closes much earlier.
    safetyTimer = setTimeout(hide, 30000);
  }

  function hide() {
    active = false;
    clearTimeout(safetyTimer);
    clearTimeout(finishTimer);
    clearInterval(pulseTimer);
    const overlay = document.getElementById('modelRunLoading');
    if (overlay) overlay.classList.remove('show');
  }

  function complete() {
    if (!active) return;
    setProgress(100);
    const th = isThai();
    const step = document.getElementById('modelRunLoadingStep');
    if (step) step.textContent = th ? 'ประมวลผลเสร็จแล้ว กำลังแสดงผล…' : 'Processing complete. Updating results…';
    setTimeout(hide, 320);
  }

  function update() {
    if (!active) return;
    const th = isThai();
    const title = document.getElementById('modelRunLoadingTitle');
    const step = document.getElementById('modelRunLoadingStep');
    if (title) title.textContent = th ? 'กำลังประมวลผลแบบจำลอง' : 'Processing model';

    const runningLog = document.querySelector('.run-log');
    if (runningLog) sawRunLog = true;

    if (phase === 'app') {
      const progressBar = document.querySelector('.run-log-bar > div');
      const raw = progressBar ? parseInt(progressBar.style.width || '0', 10) || 0 : 0;
      // Reserve the final part of the bar for the species distribution maps.
      const elapsedFallback = Math.min(34, 6 + (Date.now() - startedAt) / 260);
      setProgress(raw > 0 ? 8 + raw * 0.55 : elapsedFallback);

      const lines = Array.from(document.querySelectorAll('.run-log-lines > div'));
      const current = lines.length ? lines[lines.length - 1].textContent.replace(/^›\s*/, '') : '';
      if (step) step.textContent = current || (th
        ? 'กำลังเตรียมข้อมูลและคำนวณแบบจำลองหลัก…'
        : 'Preparing data and calculating the main model…');

      if (sawRunLog && !runningLog) {
        phase = 'maps';
        mapPhaseAt = Date.now();
        update();
        // species-analysis starts just after the main run ends. If its work is
        // CPU-bound this timer fires as soon as that work returns, not during it.
        clearTimeout(finishTimer);
        finishTimer = setTimeout(complete, 6500);
      }
      return;
    }

    const elapsed = Date.now() - mapPhaseAt;
    setProgress(Math.min(96, 66 + elapsed / 220));
    if (step) step.textContent = th
      ? 'กำลังคำนวณแผนที่ ปัจจุบัน / สถานการณ์จำลอง / การเปลี่ยนแปลง…'
      : 'Calculating Current / Scenario / Change maps…';
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action="runModel"]');
    if (!btn) return;
    show();
  }, true);

  const observer = new MutationObserver(function () {
    if (active) update();
  });

  document.addEventListener('DOMContentLoaded', function () {
    ensureOverlay();
    const app = document.getElementById('app');
    if (app) observer.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
  });
})();