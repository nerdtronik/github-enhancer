import type { Window } from "happy-dom";

export async function newBrowser(options: {
  url?: string;
  chrome?: unknown;
  script?: string;
  beforeEval?: (window: Window) => void;
} = {}): Promise<{ window: Window; chrome: unknown }> {
  const chrome = options.chrome ?? { storage: {} };
  const window = new Window({
    url: options.url ?? "https://github.com/owner/repo",
    runScripts: "dangerously-eval-string",
    pretendToBeVisual: true,
  });

  // Set up chrome.storage on the window object and make it globally accessible
  const globalChrome = { storage: chrome };
  (window as any).chrome = globalChrome;

  // Also set it as a global variable for scripts that expect chrome in global scope
  Object.defineProperty(window, "chrome", {
    writable: true,
    configurable: true,
    value: globalChrome,
  });

  // Happy-dom doesn't fully polyfill requestIdleCallback; stub it before eval'ing scripts.
  let idle: ((...args: unknown[]) => void) | undefined;
  const originalRequestIdleCallback = window.requestIdleCallback;
  if (originalRequestIdleCallback && typeof originalRequestIdleCallback === "function") {
    window.requestIdleCallback = (callback: IdleRequestCallback) => {
      idle = callback;
      callback(); // execute immediately for deterministic tests
    };
  }

  options.beforeEval?.(window);

  if (options.script) window.eval(options.script);

  // Restore original
  if (originalRequestIdleCallback && typeof originalRequestIdleCallback === "function") {
    window.requestIdleCallback = originalRequestIdleCallback;
  }

  return { window, chrome };
}
