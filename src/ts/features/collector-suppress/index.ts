/**
 * MAIN-world, document_start script: wraps fetch and sendBeacon to drop GitHub telemetry on
 * /actions pages. It exposes nothing; the wrappers are the whole effect.
 */
import { DEFAULTS } from "../../core/defaults";
import { actionsRepository, route } from "../../core/routes";

// We rely on keepalive being the only fetch mode the browser allows while the page is being
// frozen (problems.md, entry 1), so calls under this prefix get it added when the caller did not
// choose a value. Calls built from a Request object are left untouched.
const KEEPALIVE_PREFIX = "https://api.github.com/_private/browser/";

const urlOf = (input: unknown): string =>
  (input as Request | undefined)?.url ?? String(input);

// Only /actions pages are filtered; the same URLs elsewhere on github.com pass through.
const suppress = (input: unknown) =>
  DEFAULTS.TELEMETRY_URLS.has(urlOf(input)) &&
  actionsRepository(route()) !== "";

const withKeepalive = (input: RequestInfo | URL, init?: RequestInit) => {
  if (input instanceof Request || init?.keepalive !== undefined) return init;
  return String(input).startsWith(KEEPALIVE_PREFIX) ? { ...init, keepalive: true } : init;
};

// Runs as a MAIN-world content script at document_start so these wrappers are installed before
// page scripts can call (or capture a reference to) the native functions.
// A suppressed call gets an empty 204 so the caller sees a normal success, not a network error.
const nativeFetch = window.fetch;
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
  if (suppress(input)) return new Response(null, { status: 204 });
  return nativeFetch.call(window, input, withKeepalive(input, init));
};

const nativeBeacon = navigator.sendBeacon;
if (typeof nativeBeacon === "function") {
  navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null) {
    if (suppress(url)) return true;
    return nativeBeacon.call(navigator, url, data);
  };
}
