const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const script = readFileSync(`${__dirname}/../go-to-top.js`, "utf8");

function setup(t, reducedMotion = false, beforeEval) {
  const dom = new JSDOM("<main>GitHub page</main>", {
    url: "https://github.com/owner/repo",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.defineProperty(window.document, "scrollingElement", { value: window.document.documentElement });
  window.matchMedia = () => ({ matches: reducedMotion });
  beforeEval?.(window);
  window.eval(script);
  return window;
}

const nextFrame = (window) => new Promise((resolve) => window.requestAnimationFrame(resolve));
const pageReady = async (window) => {
  if (window.document.readyState !== "complete")
    await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
};

test("waits until the page is ready and idle before mounting Go to top", async (t) => {
  let idle;
  const window = setup(t, false, (page) => {
    page.requestIdleCallback = (callback) => { idle = callback; };
  });
  await pageReady(window);
  window.document.documentElement.scrollTop = window.innerHeight + 1;
  window.dispatchEvent(new window.Event("scroll"));
  await nextFrame(window);
  assert.equal(window.document.querySelector('button[aria-label="Go to top"]'), null);
  assert.equal(typeof idle, "function");
  idle();
  assert.equal(window.document.querySelector('button[aria-label="Go to top"]').hidden, false);
});

test("shows Go to top after a page scroll, then scrolls the page and hides", async (t) => {
  const window = setup(t);
  await pageReady(window);
  const button = window.document.querySelector('button[aria-label="Go to top"]');
  assert.ok(button);
  assert.equal(button.hidden, true);
  window.document.documentElement.scrollTop = window.innerHeight + 1;
  window.dispatchEvent(new window.Event("scroll"));
  await nextFrame(window);
  assert.equal(button.hidden, false);

  const calls = [];
  window.scrollTo = (options) => calls.push(options);
  button.click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].top, 0);
  assert.equal(calls[0].behavior, "smooth");

  window.document.documentElement.scrollTop = 0;
  window.dispatchEvent(new window.Event("scroll"));
  await nextFrame(window);
  assert.equal(button.hidden, true);
});

test("respects reduced motion and survives GitHub in-page navigation", async (t) => {
  const window = setup(t, true);
  await pageReady(window);
  window.document.documentElement.scrollTop = window.innerHeight + 1;
  window.dispatchEvent(new window.Event("scroll"));
  await nextFrame(window);
  window.document.body.replaceChildren(window.document.createElement("main"));
  window.history.pushState({}, "", "/owner/repo/issues");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await nextFrame(window);
  const buttons = window.document.querySelectorAll('button[aria-label="Go to top"]');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].hidden, false);
  const calls = [];
  window.scrollTo = (options) => calls.push(options);
  buttons[0].click();
  assert.equal(calls[0].behavior, "auto");
});
