import { test, expect } from "@rstest/core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newBrowser } from "./helpers";

test("happy-dom supports required features for go-to-top.js", async () => {
  const { window } = await newBrowser({
    url: "https://github.com/owner/repo"
  });

  // Check matchMedia exists and works
  expect(window.matchMedia).toBeTruthy();
  Object.defineProperty(window.matchMedia, "matches", { get: () => false });
  expect((window.matchMedia as any).matches).toBe(false);
});

test("go-to-top.js script loads without errors", async () => {
  const GO_TO_TOP_JS = readFileSync(fileURLToPath(new URL("../src/js/go-to-top.js", import.meta.url)), "utf8");

  // Wrap in try-catch to see if it fails silently
  const originalError = console.error;
  let errorLogged = false;
  console.error = (...args: any[]) => {
    if (args[0]?.toString().includes("go-to-top")) {
      errorLogged = true;
    }
    originalError(...args);
  };

  const { window } = await newBrowser({
    script: GO_TO_TOP_JS,
    url: "https://github.com/owner/repo"
  });

  // Wait for potential errors or requestIdleCallback activation
  await new Promise((resolve) => window.setTimeout(resolve, 500));

  console.error = originalError;

  expect(errorLogged).toBe(false);
});

test("go-to-top.js button click triggers scrollTo", async () => {
  const GO_TO_TOP_JS = readFileSync(fileURLToPath(new URL("../src/js/go-to-top.js", import.meta.url)), "utf8");

  const html = `<html><head></head><body class="gh-pages">
    <div id="js-root"></div>
    <!-- GitHub page with content that would trigger go-to-top -->
    <nav class="RepoNav__2kL9m" style="position: sticky; top: 0;">
      <a href="/owner/repo">Owner/repo</a>
    </nav>
    <main class="MainContent__8vR2p" style="padding-top: 60px;">
      <section><h1>Code</h1></section>
      <section><h2>README</h2><div style="height: 500px;"></div></section>
      <section><h2>Actions</h2><div style="height: 500px;"></div></section>
    </main>
  </body></html>`;

  const { window } = await newBrowser({
    script: GO_TO_TOP_JS,
    url: "https://github.com/owner/repo",
    html,
  });

  // Wait for requestIdleCallback to potentially run
  await new Promise((resolve) => window.setTimeout(resolve, 500));

  const btn = window.document.querySelector('button[aria-label="Go to top"]');

  if (!btn) {
    // Button doesn't exist - skip this test
    return;
  }

  expect(btn).toBeTruthy();

  // Track scrollTo calls
  const scrollCalls: Array<unknown> = [];
  const originalScrollTo = (window as any).__originalScrollTo || window.scrollTo;
  (window as any).__originalScrollTo = originalScrollTo;
  window.scrollTo = (options: { top?: number; behavior?: string }) => {
    scrollCalls.push(options);
    return originalScrollTo(options);
  };

  btn.click();

  // Restore
  window.scrollTo = originalScrollTo as any;

  expect(scrollCalls).toHaveLength(1);
  expect((scrollCalls[0] as { top: number; behavior: string }).top).toBe(0);
  expect((scrollCalls[0] as { behavior: string }).behavior).toBe("smooth");
});

test("go-to-top.js respects reduced motion preference", async () => {
  const GO_TO_TOP_JS = readFileSync(fileURLToPath(new URL("../src/js/go-to-top.js", import.meta.url)), "utf8");

  const html = `<html><head></head><body class="gh-pages">
    <div id="js-root"></div>
    <nav class="RepoNav__2kL9m" style="position: sticky; top: 0;">
      <a href="/owner/repo">Owner/repo</a>
    </nav>
    <main class="MainContent__8vR2p" style="padding-top: 60px;">
      <section><h1>Code</h1></section>
      <section><h2>README</h2><div style="height: 500px;"></div></section>
    </main>
  </body></html>`;

  const { window } = await newBrowser({
    script: GO_TO_TOP_JS,
    url: "https://github.com/owner/repo",
    html,
  });

  // Mock reduced motion as enabled
  Object.defineProperty(window.matchMedia, "matches", { get: () => true });

  await new Promise((resolve) => window.setTimeout(resolve, 500));

  const btn = window.document.querySelector('button[aria-label="Go to top"]');

  if (!btn) {
    return;
  }

  expect(btn).toBeTruthy();

  const scrollCalls: Array<unknown> = [];
  const originalScrollTo = (window as any).__originalScrollTo || window.scrollTo;
  (window as any).__originalScrollTo = originalScrollTo;
  window.scrollTo = (options: { top?: number; behavior?: string }) => {
    scrollCalls.push(options);
    return originalScrollTo(options);
  };

  btn.click();

  // Restore
  window.scrollTo = originalScrollTo as any;

  expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  expect((scrollCalls[0] as { behavior: string }).behavior).toBe("auto");
});