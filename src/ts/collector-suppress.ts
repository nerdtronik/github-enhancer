/**
 * @module collector-suppress
 * @description suppresses telemetry requests on GitHub pages
 */

"use strict";
(function () {
  const telemetry = new Set([
    "https://collector.github.com/github/collect",
    "https://api.github.com/_private/browser/stats",
  ]);

  const suppress = (input: URL | RequestInfo) =>
    telemetry.has(input?.toString() ?? String(input));

  const _nativeFetch = window.fetch;

  // Override fetch to suppress telemetry on Actions pages
  window.fetch = function (
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<Response> {
    if (suppress(input))
      return Promise.resolve(new Response(null, { status: 204 }));
    return _nativeFetch(input, init);
  };

  const nativeBeacon = navigator.sendBeacon;
  if (typeof nativeBeacon === "function") {
    navigator.sendBeacon = function (
      url: URL | RequestInfo,
      data?: BodyInit | Blob,
    ) {
      if (suppress(url)) return true;
      // sendBeacon is synchronous and doesn't need async wrapping
      return nativeBeacon.call(window, (url as URL).toString(), data);
    };
  }
})();
