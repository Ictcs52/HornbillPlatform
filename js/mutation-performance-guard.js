// Prevent broad app-wide class/style observers from repeatedly re-rendering Leaflet maps.
// The map comparison scripts already have explicit click/change handlers, so they do not
// need to observe every class/style mutation produced by Leaflet and the UI.
(function () {
  'use strict';

  const NativeMutationObserver = window.MutationObserver;
  if (!NativeMutationObserver || window.__hornbillMutationGuardInstalled) return;
  window.__hornbillMutationGuardInstalled = true;

  function GuardedMutationObserver(callback) {
    const observer = new NativeMutationObserver(callback);
    const nativeObserve = observer.observe.bind(observer);

    observer.observe = function (target, options) {
      const o = options || {};
      if (target && target.id === 'app' && o.subtree && o.attributes) {
        // species-analysis / compare overlay used to watch every class/style change
        // under #app. Leaflet changes styles/classes constantly, which can create a
        // render -> mutation -> render loop and make Edge report "page not responding".
        // Keep only a very small structural watch on #app itself; normal UI updates
        // are already handled by their explicit event listeners.
        return nativeObserve(target, { childList: true, subtree: false });
      }
      return nativeObserve(target, o);
    };

    return observer;
  }

  GuardedMutationObserver.prototype = NativeMutationObserver.prototype;
  window.MutationObserver = GuardedMutationObserver;

  // Centroid-shift dashed arrows were removed from the student-facing comparison.
  // Block any layer created for the old shiftArrowPane before it reaches a map/group.
  if (window.L && L.Layer && L.Layer.prototype && !window.__hornbillNoShiftArrowInstalled) {
    window.__hornbillNoShiftArrowInstalled = true;
    const nativeAddTo = L.Layer.prototype.addTo;
    L.Layer.prototype.addTo = function (target) {
      if (this && this.options && this.options.pane === 'shiftArrowPane') return this;
      return nativeAddTo.call(this, target);
    };
  }

  function scrubCentroidText() {
    const note = document.getElementById('mapRealNote');
    if (!note) return;
    note.innerHTML = note.innerHTML
      .replace(/;?\s*dashed arrows show centroid shift\.?/gi, '')
      .replace(/\s*และเส้นประคือการเลื่อนศูนย์กลางพื้นที่เหมาะสม/gi, '');
  }

  document.addEventListener('click', function () {
    setTimeout(scrubCentroidText, 0);
    setTimeout(scrubCentroidText, 120);
  });
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(scrubCentroidText, 500);
  });
})();