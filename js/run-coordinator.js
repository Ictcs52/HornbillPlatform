// Coordinates the two existing Run pipelines so they do not execute their
// CPU-heavy fits at the same time. species-analysis.js schedules its map run
// 520 ms after the Run click; this wrapper defers that one timer until the
// main app run log has completed.
(function () {
  'use strict';

  const nativeSetTimeout = window.setTimeout.bind(window);
  let runClickDispatch = false;

  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-action="runModel"]')) return;
    runClickDispatch = true;
    queueMicrotask(function () { runClickDispatch = false; });
  }, true);

  window.setTimeout = function (fn, delay) {
    const args = Array.prototype.slice.call(arguments, 2);

    // species-analysis.js deliberately uses 520 ms for its post-click model
    // build. Let app.js finish first, then start the species-map calculation.
    if (runClickDispatch && Number(delay) === 520 && typeof fn === 'function') {
      const started = Date.now();
      let sawRunLog = false;

      const waitForAppRun = function () {
        const log = document.querySelector('.run-log');
        if (log) sawRunLog = true;

        // Normal path: app.js has shown and then removed its Running log.
        // Fallback after 15 s prevents a missing log from blocking forever.
        if ((sawRunLog && !log) || Date.now() - started > 15000) {
          return nativeSetTimeout(function () { fn.apply(window, args); }, 80);
        }
        return nativeSetTimeout(waitForAppRun, 180);
      };

      return nativeSetTimeout(waitForAppRun, 540);
    }

    return nativeSetTimeout(function () { fn.apply(window, args); }, delay);
  };
})();