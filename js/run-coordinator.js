// Stability + Run coordinator for HornbillCast.
// 1) Reuses the same decoded GeoTIFFs across app/species engines.
// 2) Prevents two legacy MutationObservers from re-rendering themselves forever.
// 3) Serializes the three CPU-heavy Run pipelines instead of running them together.
(function () {
  'use strict';

  const nativeSetTimeout = window.setTimeout.bind(window);
  const NativeMutationObserver = window.MutationObserver;
  let runClickDispatch = false;
  let domReadyAt = 0;
  let startup250Handled = false;
  let startup350Handled = false;
  let deferredRunTasks = [];
  let deferredRunProcessing = false;

  // All three engines request the same four local GeoTIFFs. Decode each URL once
  // and share the Promise/raster object; this avoids 3x simultaneous GeoTIFF work.
  if (typeof window.fetchGeoTiff === 'function') {
    const nativeFetchGeoTiff = window.fetchGeoTiff;
    const rasterPromiseCache = new Map();
    window.fetchGeoTiff = function (url, name) {
      const key = String(url || '');
      if (!rasterPromiseCache.has(key)) {
        const p = Promise.resolve(nativeFetchGeoTiff(url, name)).catch(err => {
          rasterPromiseCache.delete(key);
          throw err;
        });
        rasterPromiseCache.set(key, p);
      }
      return rasterPromiseCache.get(key);
    };
  }

  // Two older observers watch #app and then modify #app again in their own
  // callback. species-results is especially expensive because every recursive
  // render recalculates suitable area. Their direct click/change hooks already
  // cover the required UI updates, so suppress only those two legacy observers.
  if (NativeMutationObserver) {
    window.MutationObserver = function (callback) {
      const src = Function.prototype.toString.call(callback);
      const isSpeciesResultsLoop = src.includes('S.ran') && src.includes('schedule(40)');
      const isSpeciesMapLoop = src.includes('ensureBar') && src.includes('scheduleRender(100)');
      if (isSpeciesResultsLoop || isSpeciesMapLoop) {
        return new NativeMutationObserver(function () {});
      }
      return new NativeMutationObserver(callback);
    };
    window.MutationObserver.prototype = NativeMutationObserver.prototype;
  }

  function runWhenIdle(fn, minDelay) {
    return nativeSetTimeout(function () {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(function () { fn(); }, { timeout: 2500 });
      } else {
        fn();
      }
    }, minDelay);
  }

  function waitForMainRunToFinish() {
    return new Promise(resolve => {
      const started = Date.now();
      let sawRunLog = false;
      const check = function () {
        const log = document.querySelector('.run-log');
        if (log) sawRunLog = true;
        if ((sawRunLog && !log) || Date.now() - started > 18000) return resolve();
        nativeSetTimeout(check, 160);
      };
      nativeSetTimeout(check, 120);
    });
  }

  function idleGap() {
    return new Promise(resolve => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(function () { resolve(); }, { timeout: 700 });
      } else {
        nativeSetTimeout(resolve, 80);
      }
    });
  }

  async function processDeferredRunTasks() {
    if (deferredRunProcessing || !deferredRunTasks.length) return;
    deferredRunProcessing = true;
    try {
      await waitForMainRunToFinish();
      const tasks = deferredRunTasks.splice(0).sort((a, b) => a.order - b.order);
      for (const task of tasks) {
        await idleGap();
        try {
          await Promise.resolve(task.fn.apply(window, task.args));
        } catch (err) {
          console.error('Deferred model task failed:', err);
        }
      }
    } finally {
      deferredRunProcessing = false;
      if (deferredRunTasks.length) processDeferredRunTasks();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    domReadyAt = Date.now();
  }, true);

  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-action="runModel"]')) return;
    runClickDispatch = true;
    queueMicrotask(function () {
      runClickDispatch = false;
      nativeSetTimeout(processDeferredRunTasks, 0);
    });
  }, true);

  window.setTimeout = function (fn, delay) {
    const args = Array.prototype.slice.call(arguments, 2);
    const d = Number(delay) || 0;

    // Startup: species-results uses 250 ms and species-analysis uses 350 ms.
    // Stagger them so page boot + raster rendering remain responsive.
    if (domReadyAt && Date.now() - domReadyAt < 1200 && typeof fn === 'function') {
      if (d === 250 && !startup250Handled) {
        startup250Handled = true;
        return runWhenIdle(function () { fn.apply(window, args); }, 1500);
      }
      if (d === 350 && !startup350Handled) {
        startup350Handled = true;
        return runWhenIdle(function () { fn.apply(window, args); }, 5200);
      }
    }

    // During a Run click, species-results schedules at 80 ms and the species
    // comparison-map engine at 520 ms. Queue both until the main app model has
    // completed, then execute 80 -> 520 sequentially.
    if (runClickDispatch && typeof fn === 'function' && (d === 80 || d === 520)) {
      deferredRunTasks.push({ fn, args, order: d });
      return nativeSetTimeout(function () {}, 0);
    }

    return nativeSetTimeout(function () { fn.apply(window, args); }, d);
  };
})();