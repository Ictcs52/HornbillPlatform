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
})();