const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const script = readFileSync(`${__dirname}/../sidebar-resize.js`, "utf8");
const css = readFileSync(`${__dirname}/../sidebar-resize.css`, "utf8");
const markup = `<aside aria-label="Actions" data-expanded="true">
  <nav aria-label="Actions workflows"></nav>
</aside>
<split-page-layout>
  <div class="PageLayout-pane"></div>
  <react-partial partial-name="actions-run-jobs-list"></react-partial>
</split-page-layout>`;

function mockStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    local: {
      async get(key) {
        return { [key]: data[key] };
      },
      async set(value) {
        Object.assign(data, value);
      },
    },
  };
}

async function setup(t, path, storage, deferResizeObserver = false) {
  const dom = new JSDOM(markup, {
    url: `https://github.com${path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  const observers = [];
  const resizeObservers = [];
  window.MutationObserver = class extends window.MutationObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe() {
      if (!deferResizeObserver) window.setTimeout(() => {
        if (!this.disconnected) this.callback();
      }, 0);
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  const aside = document.querySelector("aside");
  const layout = document.querySelector("split-page-layout");
  const pane = layout.querySelector(".PageLayout-pane");
  aside.getBoundingClientRect = () => {
    const width = parseFloat(aside.style.getPropertyValue("--gha-sidebar-width")) || 400;
    return { left: 0, right: width, width, top: 64, bottom: 900, height: 836 };
  };
  pane.getBoundingClientRect = () => {
    const defaultWidth = window.location.pathname.includes("/pull/") ? 300 : 500;
    const width = parseFloat(layout.style.getPropertyValue("--gha-sidebar-width")) || defaultWidth;
    return { left: 16, right: 16 + width, width };
  };
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  window.chrome = { storage };
  window.eval(script);
  t.after(() => {
    observers.forEach((observer) => observer.disconnect());
    window.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { window, aside, layout, pane, observers, resizeObservers };
}

function pointer(window, target, type, clientX) {
  const event = new window.MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

function drag(window, start, end) {
  const handle = window.document.querySelector(".gha-sidebar-resize-handle");
  pointer(window, handle, "pointerdown", start);
  pointer(window, handle, "pointermove", end);
  pointer(window, handle, "pointerup", end);
}

test("saves separate widths for Actions, runs, and PR Files changed", async (t) => {
  const storage = mockStorage();
  const { window, aside, layout } = await setup(t, "/owner/repo/actions", storage);
  drag(window, 400, 460);
  await Promise.resolve();
  assert.equal(aside.style.getPropertyValue("--gha-sidebar-width"), "460px");
  assert.equal(storage.data["ghaSidebarWidthV1:actions"], 460);

  window.history.pushState({}, "", "/owner/repo/actions/runs/123");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(aside.hasAttribute("data-gha-sidebar-sized"), false);
  drag(window, 516, 576);
  await Promise.resolve();
  assert.equal(layout.style.getPropertyValue("--gha-sidebar-width"), "560px");
  assert.equal(storage.data["ghaSidebarWidthV1:actions-run"], 560);

  window.history.pushState({}, "", "/owner/repo/pull/17/files");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(layout.hasAttribute("data-gha-sidebar-sized"), false);
  drag(window, 316, 376);
  await Promise.resolve();
  assert.equal(storage.data["ghaSidebarWidthV1:pull-files"], 360);
  assert.equal(storage.data["ghaSidebarWidthV1:actions-run"], 560);
});

test("Actions divider uses the full visible sidebar edge as its resize target", async (t) => {
  const storage = mockStorage();
  const { window, aside } = await setup(t, "/owner/repo/actions", storage);
  const handle = window.document.querySelector(".gha-sidebar-resize-handle");
  assert.equal(handle.classList.contains("gha-sidebar-resize-line"), true);
  assert.equal(handle.style.top, "64px");
  assert.equal(handle.style.height, "704px");
  assert.equal(handle.style.left, "395px");
  drag(window, 400, 440);
  assert.equal(aside.style.getPropertyValue("--gha-sidebar-width"), "440px");
  assert.equal(handle.style.left, "435px");
  aside.getBoundingClientRect = () => ({ right: 440, width: 440, top: -100, bottom: 300 });
  window.dispatchEvent(new window.Event("scroll"));
  assert.equal(handle.style.top, "0px");
  assert.equal(handle.style.height, "300px");
});

test("waits for the resize observer before measuring the initial sidebar edge", async (t) => {
  const { window, resizeObservers } = await setup(t, "/owner/repo/actions", mockStorage(), true);
  const handle = window.document.querySelector(".gha-sidebar-resize-handle");
  assert.equal(handle.hidden, true);
  assert.equal(handle.style.left, "");
  resizeObservers[0].callback();
  assert.equal(handle.hidden, false);
  assert.equal(handle.style.left, "395px");
});

test("keeps the resize handle aligned without measuring layout on each drag move", async (t) => {
  const { window, aside } = await setup(t, "/owner/repo/actions", mockStorage());
  const handle = window.document.querySelector(".gha-sidebar-resize-handle");
  const getBoundingClientRect = aside.getBoundingClientRect;
  let reads = 0;
  aside.getBoundingClientRect = () => { reads++; return getBoundingClientRect(); };

  pointer(window, handle, "pointerdown", 400);
  const readsAfterDown = reads;
  pointer(window, handle, "pointermove", 420);
  pointer(window, handle, "pointermove", 440);
  pointer(window, handle, "pointermove", 460);
  assert.equal(handle.style.left, "455px");
  assert.equal(reads, readsAfterDown);
  pointer(window, handle, "pointerup", 460);
});

test("refreshes the sidebar edge when a pane moves before dragging", async (t) => {
  const { window, aside } = await setup(t, "/owner/repo/actions", mockStorage());
  const handle = window.document.querySelector(".gha-sidebar-resize-handle");
  aside.getBoundingClientRect = () => ({ left: 50, right: 450, width: 400, top: 64, bottom: 900 });

  pointer(window, handle, "pointerdown", 450);
  pointer(window, handle, "pointermove", 470);
  assert.equal(handle.style.left, "465px");
  pointer(window, handle, "pointerup", 470);
});

test("removes the Actions resize handle while GitHub's sidebar is collapsed", async (t) => {
  const storage = mockStorage({ "ghaSidebarWidthV1:actions": 420 });
  const { window, aside } = await setup(t, "/owner/repo/actions", storage);
  assert.ok(window.document.querySelector(".gha-sidebar-resize-handle"));
  aside.setAttribute("data-expanded", "false");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(window.document.querySelector(".gha-sidebar-resize-handle"), null);
  assert.equal(aside.hasAttribute("data-gha-sidebar-sized"), false);

  aside.setAttribute("data-expanded", "true");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(window.document.querySelector(".gha-sidebar-resize-handle"));
  assert.equal(aside.style.getPropertyValue("--gha-sidebar-width"), "420px");
});

test("restores each page-type width across refreshes and run URLs", async (t) => {
  const storage = mockStorage({
    "ghaSidebarWidthV1:actions": 420,
    "ghaSidebarWidthV1:actions-run": 540,
    "ghaSidebarWidthV1:pull-files": 340,
  });
  const actions = await setup(t, "/owner/repo/actions/workflows/build.yml", storage);
  assert.equal(actions.aside.style.getPropertyValue("--gha-sidebar-width"), "420px");
  const run = await setup(t, "/owner/repo/actions/runs/999/job/8", storage);
  assert.equal(run.layout.style.getPropertyValue("--gha-sidebar-width"), "540px");
  const review = await setup(t, "/owner/repo/pull/18/files", storage);
  assert.equal(review.layout.style.getPropertyValue("--gha-sidebar-width"), "340px");
});

test("stops a stale resize script when extension storage is invalidated", async (t) => {
  const storage = mockStorage();
  storage.local.get = () => { throw new Error("Extension context invalidated."); };
  const { window } = await setup(t, "/owner/repo/actions", storage);
  assert.equal(window.document.querySelector(".gha-sidebar-resize-handle"), null);
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(window.document.querySelector(".gha-sidebar-resize-handle"), null);
});

test("keyboard resize is bounded and narrow layouts keep their native width", async (t) => {
  const storage = mockStorage();
  const { window, aside } = await setup(t, "/owner/repo/actions", storage);
  const handle = window.document.querySelector(".gha-sidebar-resize-handle");
  handle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await Promise.resolve();
  assert.equal(aside.style.getPropertyValue("--gha-sidebar-width"), "420px");
  assert.equal(storage.data["ghaSidebarWidthV1:actions"], 420);
  assert.equal(handle.getAttribute("aria-valuenow"), "420");
  Object.defineProperty(window, "innerWidth", { value: 700, configurable: true });
  window.dispatchEvent(new window.Event("resize"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(window.document.querySelector(".gha-sidebar-resize-handle"), null);
  assert.equal(aside.hasAttribute("data-gha-sidebar-sized"), false);
});

test("reclamps a saved width as the viewport narrows and restores it when widened", async (t) => {
  const storage = mockStorage({ "ghaSidebarWidthV1:actions": 800 });
  const { window, aside } = await setup(t, "/owner/repo/actions", storage);
  assert.equal(aside.style.getPropertyValue("--gha-sidebar-width"), "664px");

  Object.defineProperty(window, "innerWidth", { value: 900, configurable: true });
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(aside.style.getPropertyValue("--gha-sidebar-width"), "540px");

  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(aside.style.getPropertyValue("--gha-sidebar-width"), "800px");
  assert.equal(storage.data["ghaSidebarWidthV1:actions"], 800);
});

test("an older storage read cannot overwrite a newly dragged width", async (t) => {
  let resolveGet;
  const storage = mockStorage({ "ghaSidebarWidthV1:actions": 320 });
  storage.local.get = () => new Promise((resolve) => { resolveGet = resolve; });
  const { window, aside } = await setup(t, "/owner/repo/actions", storage);
  drag(window, 400, 460);
  await Promise.resolve();
  resolveGet({ "ghaSidebarWidthV1:actions": 320 });
  await Promise.resolve();

  const replacement = aside.cloneNode(true);
  replacement.style.removeProperty("--gha-sidebar-width");
  replacement.removeAttribute("data-gha-sidebar-sized");
  replacement.getBoundingClientRect = () => {
    const width = parseFloat(replacement.style.getPropertyValue("--gha-sidebar-width")) || 400;
    return { left: 0, right: width, width, top: 64, bottom: 900, height: 836 };
  };
  aside.replaceWith(replacement);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(replacement.style.getPropertyValue("--gha-sidebar-width"), "460px");
  assert.equal(storage.data["ghaSidebarWidthV1:actions"], 460);
});

test("reattaches after GitHub replaces a sidebar without leaving duplicate handles", async (t) => {
  const storage = mockStorage({ "ghaSidebarWidthV1:actions": 430 });
  const { window, aside } = await setup(t, "/owner/repo/actions", storage);
  const replacement = aside.cloneNode(true);
  replacement.getBoundingClientRect = () => {
    const width = parseFloat(replacement.style.getPropertyValue("--gha-sidebar-width")) || 400;
    return { left: 0, right: width, width, top: 64, bottom: 900, height: 836 };
  };
  window.document.body.append(
    window.document.querySelector(".gha-sidebar-resize-handle").cloneNode(true)
  );
  aside.replaceWith(replacement);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(window.document.querySelectorAll(".gha-sidebar-resize-handle").length, 1);
  assert.equal(replacement.style.getPropertyValue("--gha-sidebar-width"), "430px");
  assert.equal(aside.hasAttribute("data-gha-sidebar-sized"), false);
});
