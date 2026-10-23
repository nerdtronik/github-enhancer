(() => {
  "use strict";

  const telemetry = new Set([
    "https://collector.github.com/github/collect",
    "https://api.github.com/_private/browser/stats",
  ]);
  const suppress = (input) =>
    telemetry.has(input?.url ?? String(input)) &&
    /^\/[^/]+\/[^/]+\/actions(?:\/|$)/.test(location.pathname);

  const nativeFetch = window.fetch;
  window.fetch = async function(input, init) {
    if (suppress(input)) return Promise.resolve(new Response(null, { status: 204 }));
    // Use direct call instead of .call(this) to avoid context binding issues
    return nativeFetch(input, init);
  };

  const nativeBeacon = navigator.sendBeacon;
  if (typeof nativeBeacon === "function") {
    navigator.sendBeacon = function(url, data) {
      if (suppress(url)) return true;
      // sendBeacon is synchronous, no need to wrap in async
      return nativeBeacon(url, data);
    };
  }
})();
