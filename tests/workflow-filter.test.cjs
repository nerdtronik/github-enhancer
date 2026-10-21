const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const scriptPath = `${__dirname}/../src/js/content.js`;
const script = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
const categoriesPath = `${__dirname}/../src/js/workflow-categories.js`;
const categoriesScript = existsSync(categoriesPath) ? readFileSync(categoriesPath, "utf8") : "";
const categoryKey = "ghaWorkflowCategoriesV2:owner/repo";
const savedCategory = (storage, name) => storage.data[categoryKey]?.categories
  .find((item) => item.name === name);
const workflow = (name, file) =>
  `<li><a href="/owner/repo/actions/workflows/${file}">${name}</a></li>`;
const currentSidebar = `
  <div class="workflow-scroll" style="overflow-y: auto">
  <nav aria-label="Actions workflows" data-component="NavList">
    <ul data-component="ActionList">
      <li><a href="/owner/repo/actions">All workflows</a></li>
      <li data-component="ActionList.Group"><h3>Workflows</h3><ul>
        ${workflow("Build application", "build.yml")}
        ${workflow("Deploy production", "deploy.yml")}
      </ul></li>
    </ul>
  </nav>
  <nav aria-label="Management"><ul><li><a href="/owner/repo/actions/caches">Caches</a></li></ul></nav>
  </div>
  <main><ul>${workflow("Run result", "build.yml")}</ul></main>`;

function mockStorage() {
  const data = {};
  return {
    data,
    local: {
      async get(keys) {
        return Object.fromEntries((Array.isArray(keys) ? keys : [keys])
          .map((key) => [key, data[key]]));
      },
      async set(value) { Object.assign(data, value); },
    },
  };
}

async function setup(t, html = currentSidebar, path = "/owner/repo/actions", storage = mockStorage(), fetch, beforeEval) {
  const dom = new JSDOM(html, {
    url: `https://github.com${path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const observers = [];
  dom.window.MutationObserver = class extends dom.window.MutationObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  const resizeObservers = [];
  dom.window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe() {
      dom.window.setTimeout(() => { if (!this.disconnected) this.callback(); }, 0);
    }
    unobserve() {}
    disconnect() { this.disconnected = true; }
  };
  dom.window.notifyResizeObservers = () => {
    for (const observer of resizeObservers) if (!observer.disconnected) observer.callback();
  };
  t.after(() => {
    observers.forEach((observer) => observer.disconnect());
    dom.window.close();
  });
  dom.window.chrome = { storage };
  if (fetch) dom.window.fetch = fetch;
  beforeEval?.(dom.window);
  dom.window.eval(categoriesScript);
  dom.window.eval(script);
  await settle(dom.window);
  return dom.window;
}

const settle = (window) =>
  new Promise((resolve) => window.setTimeout(resolve, 70));
const input = (window) =>
  window.document.querySelector('input[aria-label="Filter workflows"]');
const filtered = (element) => element.hasAttribute("data-gha-workflow-hidden");

function search(window, value) {
  input(window).value = value;
  input(window).dispatchEvent(new window.Event("input", { bubbles: true }));
}

function button(root, name) {
  const found = [...root.querySelectorAll("button")].find((item) =>
    item.textContent.trim() === name || item.getAttribute("aria-label") === name);
  assert.ok(found, `Missing ${name} button`);
  return found;
}

function category(window, name) {
  return [...window.document.querySelectorAll("[data-gha-category-name]")]
    .find((section) => section.getAttribute("data-gha-category-name") === name);
}

async function createCategory(window, name) {
  button(window.document, "New category").click();
  const field = window.document.querySelector('input[aria-label="Category name"]');
  field.value = name;
  button(field.closest("form"), "Save").click();
  await settle(window);
}

function options(window, categoryName) {
  const menu = category(window, categoryName).querySelector(".gha-workflow-category-options");
  assert.ok(menu, `Missing ${categoryName} options`);
  menu.querySelector("summary").click();
  return menu;
}

async function assign(window, categoryName, workflowName) {
  const link = [...window.document.querySelectorAll('nav[aria-label="Actions workflows"] a[href*="/actions/workflows/"], .gha-workflow-category-row a')]
    .find((item) => item.textContent.trim() === workflowName && !filtered(item.closest("li")));
  assert.ok(link, `Missing visible ${workflowName} workflow`);
  const picker = link.closest("li").querySelector(".gha-workflow-category-picker");
  assert.ok(picker, `Missing ${workflowName} category picker`);
  picker.querySelector("summary").click();
  button(picker, categoryName).click();
  await settle(window);
}

async function importCategories(window, backup) {
  window.document.querySelector('summary[aria-label="Category backup options"]').click();
  button(window.document, "Import categories").click();
  const file = window.document.querySelector('input[aria-label="Choose category backup"]');
  Object.defineProperty(file, "files", { value: [{ text: async () => JSON.stringify(backup) }] });
  file.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle(window);
}

test("adds an accessible filter to the current sidebar without needing GitHub's search icon", async (t) => {
  const window = await setup(t);
  assert.ok(input(window));
  assert.equal(input(window).type, "search");
  assert.ok(
    window.document.querySelector(".workflow-scroll").contains(input(window))
  );
  assert.equal(
    window.document.querySelector("nav").contains(input(window)),
    false
  );
  assert.equal(window.document.activeElement, window.document.body);
});

test("clears the workflow filter with its x button and restores the list", async (t) => {
  const window = await setup(t);
  const clear = button(window.document, "Clear workflow filter");
  assert.equal(clear.hidden, true);
  search(window, "deploy");
  assert.equal(clear.hidden, false);
  assert.equal(filtered(window.document.querySelector('a[href$="build.yml"]').closest("li")), true);
  clear.click();
  assert.equal(input(window).value, "");
  assert.equal(clear.hidden, true);
  assert.equal(filtered(window.document.querySelector('a[href$="build.yml"]').closest("li")), false);
  assert.equal(window.document.activeElement, input(window));
});

test("reuses the sidebar scroll container on unrelated DOM changes", async (t) => {
  let scrollStyleReads = 0;
  const window = await setup(t, currentSidebar, "/owner/repo/actions", mockStorage(), undefined, (win) => {
    const getComputedStyle = win.getComputedStyle.bind(win);
    win.getComputedStyle = (element) => {
      if (element.classList?.contains("workflow-scroll")) scrollStyleReads++;
      return getComputedStyle(element);
    };
  });
  const initialReads = scrollStyleReads;
  window.document.body.append(window.document.createElement("div"));
  await settle(window);
  assert.equal(scrollStyleReads, initialReads);
});

test("skips sidebar sync when only run content changes", async (t) => {
  const window = await setup(t);
  const originalSync = window.GHAWorkflowCategories.sync;
  let syncs = 0;
  window.GHAWorkflowCategories.sync = (...args) => {
    syncs++;
    return originalSync(...args);
  };
  const main = window.document.querySelector("main");
  for (let index = 0; index < 100; index++) main.append(window.document.createElement("div"));
  main.querySelector("li").setAttribute("aria-current", "page");
  await settle(window);
  assert.equal(syncs, 0);
});

test("filters workflows with one sidebar sync per keystroke", async (t) => {
  const window = await setup(t);
  const originalSync = window.GHAWorkflowCategories.sync;
  let syncs = 0;
  window.GHAWorkflowCategories.sync = (...args) => {
    syncs++;
    return originalSync(...args);
  };
  search(window, "build");
  await settle(window);
  assert.equal(syncs, 1);
  assert.equal(filtered(window.document.querySelector('nav a[href$="deploy.yml"]').closest("li")), true);
});

test("does not remeasure an unchanged native category picker", async (t) => {
  const markup = currentSidebar.replace(
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<span data-component="ActionList.TrailingAction">' +
      '<button aria-label="Pin Build application"></button></span>'
  );
  const window = await setup(t, markup);
  const row = window.document.querySelector('nav a[href$="build.yml"]').closest("li");
  const pin = row.querySelector('button[aria-label="Pin Build application"]');
  let reads = 0;
  row.getBoundingClientRect = pin.getBoundingClientRect = () => {
    reads++;
    return { left: 300, right: 400, width: 40 };
  };
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle(window);
  assert.equal(reads, 0);

  row.querySelector(".gha-workflow-category-picker").remove();
  await settle(window);
  assert.ok(row.querySelector(".gha-workflow-category-picker"));
});

test("positions native category pickers without measuring pin geometry on first render", async (t) => {
  const markup = currentSidebar.replace(
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<span data-component="ActionList.TrailingAction" class="pinButton">' +
      '<button aria-label="Pin Build application"></button></span>'
  );
  let reads = 0;
  let notifyResize;
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), undefined, (win) => {
    win.ResizeObserver = class {
      constructor(callback) { notifyResize = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const original = win.Element.prototype.getBoundingClientRect;
    win.Element.prototype.getBoundingClientRect = function (...args) {
      if (this.matches?.('button[aria-label="Pin Build application"]')) {
        reads++;
        return { left: 361, width: 32 };
      }
      if (this.tagName === "LI" && this.querySelector('button[aria-label="Pin Build application"]')) {
        reads++;
        return { right: 437, width: 400 };
      }
      return original.apply(this, args);
    };
  });
  const row = window.document.querySelector('nav a[href$="build.yml"]').closest("li");
  assert.ok(row.querySelector(".gha-workflow-category-picker[data-gha-has-pin]"));
  assert.equal(reads, 0);
  notifyResize();
  assert.equal(reads, 2);
  assert.equal(row.style.getPropertyValue("--gha-native-picker-inset"), "76px");
});

test("updates pinned workflows when an external pin label changes", async (t) => {
  const markup = currentSidebar.replace(
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<button aria-labelledby="build-pin-label"></button>'
  ) + '<span id="build-pin-label">Pin Build application</span>';
  const window = await setup(t, markup);
  assert.equal(window.document.querySelector('.gha-workflow-pinned a[href$="build.yml"]'), null);
  window.document.getElementById("build-pin-label").textContent = "Unpin Build application";
  await settle(window);
  assert.ok(window.document.querySelector('.gha-workflow-pinned a[href$="build.yml"]'));
});

test("fetches extra workflows immediately but waits for idle before showing them", async (t) => {
  const idleCallbacks = [];
  const requests = [];
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [
    { name: "Quality", workflows: ["lint.yml"], collapsed: false },
  ] };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage, async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [{ id: 3, name: "Lint", path: ".github/workflows/lint.yml" }], totalCount: 1,
    } } }) };
  }, (page) => {
    page.requestIdleCallback = (callback) => { idleCallbacks.push(callback); };
  });
  assert.deepEqual(requests, ["/owner/repo/actions/_workflows?page=1&sort=default"]);
  assert.ok(window.document.querySelector('nav a[href$="build.yml"]'));
  assert.equal(window.document.querySelector('.gha-workflow-api-list a[href$="lint.yml"]'), null);
  assert.equal(window.document.querySelector(".gha-workflow-categories"), null);
  assert.equal(idleCallbacks.length, 1);
  idleCallbacks[0]();
  assert.ok(window.document.querySelector('.gha-workflow-api-list a[href$="lint.yml"]'));
  await settle(window);
  assert.ok(category(window, "Quality").querySelector('a[href$="lint.yml"]'));
});

test("keeps categories hidden until the browser actually reaches idle", async (t) => {
  const idleCallbacks = [];
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [
    { name: "Quality", workflows: ["lint.yml"], collapsed: false },
  ] };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage, async () => ({
    ok: true, json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [{ id: 3, name: "Lint", path: ".github/workflows/lint.yml" }], totalCount: 1,
    } } }),
  }), (page) => {
    page.requestIdleCallback = (callback, options) => {
      idleCallbacks.push(callback);
      if (options?.timeout) page.setTimeout(() => callback({ didTimeout: true }), 0);
    };
  });
  assert.equal(window.document.querySelector(".gha-workflow-categories"), null);
  idleCallbacks[0]({ didTimeout: false });
  await settle(window);
  assert.ok(category(window, "Quality").querySelector('a[href$="lint.yml"]'));
});

test("filter input shows a fetched workflow without waiting for idle", async (t) => {
  const idleCallbacks = [];
  const window = await setup(t, currentSidebar, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true, json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [{ id: 3, name: "Lint", path: ".github/workflows/lint.yml" }], totalCount: 1,
    } } }),
  }), (page) => {
    page.requestIdleCallback = (callback) => { idleCallbacks.push(callback); };
  });
  assert.equal(window.document.querySelector('.gha-workflow-api-list a[href$="lint.yml"]'), null);
  const originalSync = window.GHAWorkflowCategories.sync;
  let syncs = 0;
  window.GHAWorkflowCategories.sync = (...args) => {
    syncs++;
    return originalSync(...args);
  };
  search(window, "lint");
  assert.ok(window.document.querySelector('.gha-workflow-api-list a[href$="lint.yml"]'));
  assert.equal(syncs, 1);
  idleCallbacks[0]();
  assert.equal(window.document.querySelectorAll('.gha-workflow-api-list a[href$="lint.yml"]').length, 1);
});

test("reuses the fetched workflow font until GitHub replaces its native link", async (t) => {
  const storage = mockStorage();
  storage.data["ghaWorkflowIndexV1:owner/repo"] = {
    workflows: [{ id: 3, name: "Lint", path: ".github/workflows/lint.yml" }], uses: 0,
  };
  let reads = 0;
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage, async () => {}, (win) => {
    const original = win.getComputedStyle.bind(win);
    win.getComputedStyle = (element) => {
      if (element.matches?.('nav a[href$="build.yml"]')) reads++;
      return original(element);
    };
  });
  assert.ok(window.document.querySelector(".gha-workflow-api-list"));
  reads = 0;
  window.document.querySelector('nav[aria-label="Actions workflows"] ul ul')
    .append(window.document.createElement("li"));
  await settle(window);
  assert.equal(reads, 0);

  const originalLink = window.document.querySelector('nav a[href$="build.yml"]');
  const replacement = originalLink.cloneNode(true);
  replacement.style.fontSize = "17px";
  originalLink.replaceWith(replacement);
  await settle(window);
  assert.ok(reads > 0);
  assert.equal(window.document.querySelector(".gha-workflow-api-list").style.fontSize, "17px");

  replacement.style.fontSize = "19px";
  window.dispatchEvent(new window.Event("resize"));
  await settle(window);
  assert.equal(window.document.querySelector(".gha-workflow-api-list").style.fontSize, "19px");
});

test("reuses the fetched workflow font when GitHub replaces a link with the same styling", async (t) => {
  const storage = mockStorage();
  storage.data["ghaWorkflowIndexV1:owner/repo"] = {
    workflows: [{ id: 3, name: "Lint", path: ".github/workflows/lint.yml" }], uses: 0,
  };
  let reads = 0;
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage, async () => {}, (win) => {
    const original = win.getComputedStyle.bind(win);
    win.getComputedStyle = (element) => {
      if (element.matches?.('nav a[href$="build.yml"]')) reads++;
      return original(element);
    };
  });
  reads = 0;
  const originalLink = window.document.querySelector('nav a[href$="build.yml"]');
  originalLink.replaceWith(originalLink.cloneNode(true));
  await settle(window);
  assert.equal(reads, 0);
});

test("refreshes the fetched workflow font when native row styling changes", async (t) => {
  const storage = mockStorage();
  storage.data["ghaWorkflowIndexV1:owner/repo"] = {
    workflows: [{ id: 3, name: "Lint", path: ".github/workflows/lint.yml" }], uses: 0,
  };
  const markup = currentSidebar.replace(
    '<li><a href="/owner/repo/actions/workflows/build.yml">',
    '<li style="font-size: 14px"><a href="/owner/repo/actions/workflows/build.yml">'
  );
  const window = await setup(t, markup, "/owner/repo/actions", storage, async () => {}, (win) => {
    const original = win.getComputedStyle.bind(win);
    win.getComputedStyle = (element) => element.matches?.('nav a[href$="build.yml"]')
      ? { fontSize: element.closest("li").style.fontSize } : original(element);
  });
  const fetched = window.document.querySelector(".gha-workflow-api-list");
  assert.equal(fetched.style.fontSize, "14px");
  const row = window.document.querySelector('nav a[href$="build.yml"]').closest("li");
  row.style.fontSize = "20px";
  row.parentElement.append(window.document.createElement("li"));
  await settle(window);
  assert.equal(fetched.style.fontSize, "20px");
});

test("places fetched workflow pickers beside fixed-width pins without measuring rows", async (t) => {
  const storage = mockStorage();
  storage.data["ghaWorkflowIndexV1:owner/repo"] = {
    workflows: [{ id: 3, name: "Lint", path: ".github/workflows/lint.yml" }], uses: 0,
  };
  let reads = 0;
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage, async () => {}, (win) => {
    const style = win.document.createElement("style");
    style.textContent = readFileSync(`${__dirname}/../src/css/content.css`, "utf8");
    win.document.head.append(style);
    const original = win.Element.prototype.getBoundingClientRect;
    win.Element.prototype.getBoundingClientRect = function (...args) {
      if (this.closest?.(".gha-workflow-api-row")) reads++;
      return original.apply(this, args);
    };
  });
  const row = window.document.querySelector(".gha-workflow-api-row");
  assert.ok(row.querySelector(".gha-workflow-category-picker[data-gha-has-pin]"));
  assert.equal(reads, 0);
  assert.equal(window.getComputedStyle(row).getPropertyValue("--gha-native-picker-inset").trim(), "32px");
});

test("finds a new scroll container when GitHub changes overflow in place", async (t) => {
  const markup = `<div class="outer-scroll" style="overflow-y: auto">${currentSidebar}</div>`;
  const window = await setup(t, markup);
  const inner = window.document.querySelector(".workflow-scroll");
  const outer = window.document.querySelector(".outer-scroll");
  assert.ok(inner.querySelector(":scope > .gha-workflow-filter"));

  inner.style.overflowY = "visible";
  window.dispatchEvent(new window.PopStateEvent("popstate"));
  await settle(window);
  assert.ok(outer.querySelector(":scope > .gha-workflow-filter"));
});

test("places All workflows below the filter and labels categories like the native workflow list", async (t) => {
  const window = await setup(t);
  const host = window.document.querySelector(".workflow-scroll");
  const filter = host.querySelector(":scope > .gha-workflow-filter");
  const categories = host.querySelector(":scope > .gha-workflow-categories");
  const nativeLink = host.querySelector('nav[aria-label="Actions workflows"] a[href="/owner/repo/actions"]');
  const allLink = categories.querySelector(".gha-workflow-all-link");
  const heading = categories.querySelector(".gha-workflow-category-title");

  assert.equal(filter.nextElementSibling, categories);
  assert.equal(categories.firstElementChild, allLink);
  assert.equal(allLink.href, nativeLink.href);
  assert.equal(allLink.getAttribute("aria-current"), "page");
  assert.equal(nativeLink.closest("li").hasAttribute("data-gha-workflow-all-hidden"), true);
  assert.equal(heading.tagName, "H3");
  assert.equal(heading.textContent, "Categories");
  assert.equal(heading.parentElement.className, "gha-workflow-categories-heading");
  assert.equal(heading.nextElementSibling.className, "gha-workflow-category-heading-actions");
  assert.equal(categories.querySelector(".gha-workflow-category-empty li button")?.textContent, "New category");

  let clicks = 0;
  nativeLink.addEventListener("click", (event) => { event.preventDefault(); clicks++; });
  allLink.click();
  assert.equal(clicks, 1);

  window.history.pushState({}, "", "/owner/repo/actions/workflows/build.yml");
  window.dispatchEvent(new window.PopStateEvent("popstate"));
  await settle(window);
  assert.equal(categories.isConnected, false);
  assert.equal(host.querySelector(".gha-workflow-all-link").hasAttribute("aria-current"), false);

  window.history.pushState({}, "", "/owner/repo/pulls");
  window.dispatchEvent(new window.PopStateEvent("popstate"));
  await settle(window);
  assert.equal(nativeLink.closest("li").hasAttribute("data-gha-workflow-all-hidden"), false);
});

test("shows an accessible New category icon in the heading after the first category is created", async (t) => {
  const window = await setup(t);
  await createCategory(window, "CI");
  const categories = window.document.querySelector(".gha-workflow-categories");
  assert.equal(categories.querySelector(".gha-workflow-category-empty"), null);
  const add = categories.querySelector(".gha-workflow-category-new");
  assert.equal(add?.textContent, "+");
  assert.equal(add?.getAttribute("aria-label"), "New category");
  assert.equal(add?.title, "New category");
});

test("leaves GitHub's collapsed Actions sidebar untouched and restores controls on expand", async (t) => {
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [{ name: "CI", workflows: ["build.yml"], collapsed: false }] };
  const markup = currentSidebar
    .replace('  <nav aria-label="Actions workflows"',
      '  <aside aria-label="Actions" data-expanded="true"><nav aria-label="Actions workflows"')
    .replace('  <nav aria-label="Management"',
      '  </aside><nav aria-label="Management"');
  const window = await setup(t, markup, "/owner/repo/actions", storage);
  const aside = window.document.querySelector('aside[aria-label="Actions"]');
  const host = window.document.querySelector(".workflow-scroll");
  const nativeRow = aside.querySelector('nav a[href$="build.yml"]').closest("li");
  assert.ok(host.querySelector(":scope > .gha-workflow-filter"));
  assert.equal(aside.querySelector(".gha-workflow-filter"), null);
  assert.ok(aside.querySelector(".gha-workflow-categories"));
  assert.equal(filtered(nativeRow), true);

  aside.setAttribute("data-expanded", "false");
  await settle(window);
  assert.equal(host.querySelector(".gha-workflow-filter"), null);
  assert.equal(aside.querySelector(".gha-workflow-categories"), null);
  assert.equal(aside.querySelector(".gha-workflow-category-picker"), null);
  assert.equal(filtered(nativeRow), false);

  aside.setAttribute("data-expanded", "true");
  await settle(window);
  assert.ok(host.querySelector(":scope > .gha-workflow-filter"));
  assert.ok(aside.querySelector(".gha-workflow-categories"));
  assert.equal(filtered(nativeRow), true);
});

test("filters the full fetched workflow list in GitHub's collapsed flyout", async (t) => {
  const markup = currentSidebar
    .replace('  <nav aria-label="Actions workflows"',
      '  <aside aria-label="Actions" data-expanded="false"><nav aria-label="Actions workflows"')
    .replace('  <nav aria-label="Management"',
      '  </aside><nav aria-label="Management"');
  const popup = '<div id="__primerPortalRoot__"><div data-component="Portal">' +
      '<div role="none" data-component="AnchoredOverlay" style="overflow-y: auto">' +
      '<nav aria-label="Workflows" data-component="NavList"><ul>' +
      workflow("Build application", "build.yml") +
      '<li><button id="popup-more">Show more</button></li></ul></nav>' +
      '</div></div></div>';
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [
        { id: 1, name: "Build application", path: ".github/workflows/build.yml" },
        { id: 2, name: "Lint checks", path: ".github/workflows/lint.yml" },
        { id: 3, name: "Deploy production", path: ".github/workflows/deploy.yml" },
      ], totalCount: 3,
    } } }),
  }));
  const style = window.document.createElement("style");
  style.textContent = readFileSync(`${__dirname}/../src/css/content.css`, "utf8");
  window.document.head.append(style);
  window.document.body.insertAdjacentHTML("beforeend", popup);
  await settle(window);
  const overlay = window.document.querySelector('[data-component="AnchoredOverlay"]');
  assert.ok(overlay.querySelector(":scope > .gha-workflow-filter"));
  assert.deepEqual([...overlay.querySelectorAll('a[href*="/actions/workflows/"]')]
    .map((link) => link.textContent), ["Build application", "Lint checks", "Deploy production"]);
  assert.equal(overlay.querySelector(".gha-workflow-categories"), null);
  assert.equal(overlay.querySelector(".gha-workflow-category-picker"), null);
  assert.equal(window.document.getElementById("popup-more").classList.contains("gha-workflow-show-more-hidden"), true);
  assert.equal(window.getComputedStyle(window.document.getElementById("popup-more").parentElement).display, "none");

  search(window, "deploy");
  await settle(window);
  assert.deepEqual([...overlay.querySelectorAll('a[href*="/actions/workflows/"]')]
    .filter((link) => !filtered(link.closest("li"))).map((link) => link.textContent),
  ["Deploy production"]);

  window.document.getElementById("__primerPortalRoot__").remove();
  await settle(window);
  assert.equal(window.document.querySelector(".gha-workflow-filter"), null);
});

test("aligns fetched flyout rows and hides native pin controls", async (t) => {
  const markup = currentSidebar
    .replace('  <nav aria-label="Actions workflows"',
      '  <aside aria-label="Actions" data-expanded="false"><nav aria-label="Actions workflows"')
    .replace('  <nav aria-label="Management"',
      '  </aside><nav aria-label="Management"');
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [
        { id: 1, name: "Build application", path: ".github/workflows/build.yml" },
        { id: 2, name: "Deploy production", path: ".github/workflows/deploy.yml" },
        { id: 3, name: "Lint checks", path: ".github/workflows/lint.yml" },
      ], totalCount: 3,
    } } }),
  }), (page) => {
    const style = page.document.createElement("style");
    style.textContent = readFileSync(`${__dirname}/../src/css/content.css`, "utf8");
    page.document.head.append(style);
  });
  window.document.body.insertAdjacentHTML("beforeend", `
    <div id="__primerPortalRoot__"><div data-component="AnchoredOverlay" style="overflow-y: auto">
      <nav aria-label="Workflows"><ul>
        <li><a href="/owner/repo/actions/workflows/build.yml">Build application</a>
          <span data-component="ActionList.TrailingAction" class="pinButton__test">
            <button aria-labelledby="build-pin-label"></button></span></li>
        <li><a href="/owner/repo/actions/workflows/deploy.yml">Deploy production</a>
          <span data-component="ActionList.TrailingAction" class="pinButton__test">
            <button aria-labelledby="deploy-unpin-label"></button></span></li>
      </ul></nav>
    </div></div>
    <span id="build-pin-label">Pin Build application</span>
    <span id="deploy-unpin-label">Unpin Deploy production</span>`);
  await settle(window);
  const flyout = window.document.querySelector('nav[aria-label="Workflows"]');
  const rows = flyout.querySelectorAll("li");
  assert.equal(window.getComputedStyle(rows[0].querySelector('[data-component="ActionList.TrailingAction"]')).opacity, "0");
  assert.equal(window.getComputedStyle(rows[1].querySelector('[data-component="ActionList.TrailingAction"]')).opacity, "0");
  assert.equal(window.getComputedStyle(flyout.nextElementSibling).paddingLeft, "16px");
});

test("filters names case insensitively and clearing restores rows without touching run results", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  const build = sidebar.querySelector('a[href$="build.yml"]').closest("li");
  const deploy = sidebar.querySelector('a[href$="deploy.yml"]').closest("li");
  const all = sidebar
    .querySelector('a[href="/owner/repo/actions"]')
    .closest("li");
  search(window, "  DEPLOY  ");
  assert.equal(filtered(build), true);
  assert.equal(filtered(deploy), false);
  assert.equal(filtered(all), false);
  assert.equal(filtered(window.document.querySelector("main li")), false);
  assert.equal(
    filtered(window.document.querySelector('[aria-label="Management"] li')),
    false
  );
  search(window, "missing");
  assert.equal(filtered(deploy), true);
  search(window, "");
  assert.equal(filtered(build), false);
  assert.equal(filtered(deploy), false);
});

test("groups a workflow in several categories without moving its native link or pin control", async (t) => {
  const window = await setup(t);
  const nativeLink = window.document.querySelector('nav[aria-label="Actions workflows"] a[href$="build.yml"]');
  const nativeRow = nativeLink.closest("li");
  const nativePin = window.document.createElement("button");
  nativePin.setAttribute("aria-label", "Pin workflow");
  nativePin.textContent = "Pin";
  nativeRow.append(nativePin);
  let linksClicked = 0;
  let pinsClicked = 0;
  nativeLink.addEventListener("click", (event) => { event.preventDefault(); linksClicked++; });
  nativePin.addEventListener("click", () => pinsClicked++);

  await createCategory(window, "CI");
  await createCategory(window, "Important");
  assert.equal([...options(window, "CI").querySelectorAll("button")]
    .some((item) => item.textContent.trim() === "Edit workflows"), false);
  await assign(window, "CI", "Build application");
  assert.equal([...category(window, "CI").querySelectorAll(".gha-workflow-category-picker button")]
    .some((item) => item.textContent.trim() === "CI"), false);
  await assign(window, "Important", "Build application");
  assert.equal(filtered(nativeRow), true);
  assert.equal(nativeRow.contains(nativeLink), true);
  for (const name of ["CI", "Important"])
    assert.ok(category(window, name).querySelector('a[href$="build.yml"]'));
  category(window, "CI").querySelector('a[href$="build.yml"]').click();
  category(window, "CI").querySelector('button[aria-label="Pin workflow"]').click();
  assert.equal(linksClicked, 1);
  assert.equal(pinsClicked, 1);
  window.setTimeout(() => nativePin.setAttribute("aria-label", "Unpin workflow"), 10);
  await settle(window);
  assert.ok(category(window, "CI").querySelector('button[aria-label="Unpin workflow"]'));
  const replacementPin = nativePin.cloneNode(true);
  let replacementClicks = 0;
  replacementPin.addEventListener("click", () => replacementClicks++);
  nativePin.replaceWith(replacementPin);
  await settle(window);
  category(window, "CI").querySelector('button[aria-label="Unpin workflow"]').click();
  assert.equal(replacementClicks, 1);

  search(window, "deploy");
  assert.equal(filtered(window.document.querySelector('nav a[href$="deploy.yml"]').closest("li")), false);
  assert.equal(category(window, "CI").querySelector('a[href$="build.yml"]'), null);
});

test("keeps the native category picker clear of the pin as the sidebar resizes", async (t) => {
  const markup = currentSidebar.replace(
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<span class="pinButton__test" data-component="ActionList.TrailingAction">' +
      '<button data-component="IconButton" aria-labelledby="build-pin-tooltip"></button></span>' +
      '<span id="build-pin-tooltip">Pin workflow</span>'
  );
  const window = await setup(t, markup);
  const row = window.document.querySelector('nav a[href$="build.yml"]').closest("li");
  const pin = row.querySelector('[data-component="ActionList.TrailingAction"] button');
  const picker = row.querySelector(".gha-workflow-category-picker");
  row.getBoundingClientRect = () => ({ right: 437, width: 400 });
  pin.getBoundingClientRect = () => ({ left: 361, width: 32 });
  window.dispatchEvent(new window.Event("resize"));
  window.notifyResizeObservers();
  assert.equal(row.style.getPropertyValue("--gha-native-picker-inset"), "76px");
  assert.equal(picker.hasAttribute("data-gha-has-pin"), true);
  const summary = picker.querySelector("summary");
  assert.equal(summary.title, "Add to category");
  assert.equal(summary.getAttribute("aria-label"), "Add Build application to categories");
  assert.equal(picker.querySelector("tool-tip"), null);
  assert.equal(picker, row.querySelector(".gha-workflow-category-picker"));

  pin.getBoundingClientRect = () => ({ left: 329, width: 32 });
  window.dispatchEvent(new window.Event("resize"));
  window.notifyResizeObservers();
  assert.equal(row.style.getPropertyValue("--gha-native-picker-inset"), "108px");
});

test("keeps the category picker clear of an unpin control without a pinButton class", async (t) => {
  const markup = currentSidebar.replace(
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<span data-component="ActionList.TrailingAction">' +
      '<button data-component="IconButton" aria-labelledby="build-unpin-tooltip"></button></span>' +
      '<span id="build-unpin-tooltip">Unpin workflow</span>'
  );
  const window = await setup(t, markup);
  const row = window.document.querySelector('nav a[href$="build.yml"]').closest("li");
  const pin = row.querySelector('[data-component="IconButton"]');
  row.getBoundingClientRect = () => ({ right: 393, width: 377 });
  pin.getBoundingClientRect = () => ({ left: 361, width: 32 });
  window.dispatchEvent(new window.Event("resize"));
  window.notifyResizeObservers();
  assert.equal(row.querySelector(".gha-workflow-category-picker").hasAttribute("data-gha-has-pin"), true);
  assert.equal(row.style.getPropertyValue("--gha-native-picker-inset"), "32px");
});

test("hides pin and unpin controls when a row is idle", async (t) => {
  const markup = currentSidebar
    .replace('<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
      '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<span data-component="ActionList.TrailingAction"><button aria-label="Unpin Build application"></button></span>')
    .replace('<a href="/owner/repo/actions/workflows/deploy.yml">Deploy production</a>',
      '<a href="/owner/repo/actions/workflows/deploy.yml">Deploy production</a>' +
      '<span data-component="ActionList.TrailingAction"><button aria-label="Pin Deploy production"></button></span>');
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [{ name: "CI", workflows: ["build.yml", "deploy.yml"], collapsed: false }] };
  const window = await setup(t, markup, "/owner/repo/actions", storage, undefined, (page) => {
    const style = page.document.createElement("style");
    style.textContent = readFileSync(`${__dirname}/../src/css/content.css`, "utf8");
    page.document.head.append(style);
  });
  const nativeRows = window.document.querySelectorAll('nav[aria-label="Actions workflows"] li:has(> a[href*="/actions/workflows/"])');
  const categoryRows = category(window, "CI").querySelectorAll(".gha-workflow-category-row");
  assert.equal(window.getComputedStyle(nativeRows[0].querySelector('[data-component="ActionList.TrailingAction"]')).opacity, "0");
  assert.equal(window.getComputedStyle(nativeRows[1].querySelector('[data-component="ActionList.TrailingAction"]')).opacity, "0");
  assert.equal(window.getComputedStyle(categoryRows[0].querySelector(".gha-workflow-category-pin")).opacity, "0");
  assert.equal(window.getComputedStyle(categoryRows[1].querySelector(".gha-workflow-category-pin")).opacity, "0");
});

test("shows categorized pins first and hides every category row when collapsed", async (t) => {
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [
    { name: "CI", workflows: ["build.yml", "deploy.yml"], collapsed: true },
    { name: "Important", workflows: ["build.yml"], collapsed: true },
  ] };
  const markup = currentSidebar
    .replace('<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
      '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<span class="pinButton__test" data-component="ActionList.TrailingAction">' +
      '<button data-component="IconButton" aria-labelledby="build-pin-tooltip"></button></span>' +
      '<span id="build-pin-tooltip">Unpin workflow</span>')
    .replace('<a href="/owner/repo/actions/workflows/deploy.yml">Deploy production</a>',
      '<a href="/owner/repo/actions/workflows/deploy.yml">Deploy production</a>' +
      '<button aria-label="Pin Deploy production"></button>');
  const window = await setup(t, markup, "/owner/repo/actions", storage);
  const nativeRow = window.document.querySelector('nav a[href$="build.yml"]').closest("li");
  const pinTooltip = nativeRow.querySelector("#build-pin-tooltip");
  const ci = category(window, "CI");
  const pinned = window.document.querySelector(".gha-workflow-pinned");
  assert.equal(pinned.querySelector("h3")?.textContent, "Pinned workflows");
  assert.equal(pinned.nextElementSibling.querySelector("h3")?.textContent, "Categories");
  assert.deepEqual([...pinned.querySelectorAll(".gha-workflow-category-row a")]
    .map((link) => link.textContent), ["Build application"]);
  assert.equal(ci.querySelector(".gha-workflow-category-count").parentElement,
    ci.querySelector(".gha-workflow-category-toggle"));
  assert.equal(ci.querySelector(".gha-workflow-category-toggle").getAttribute("aria-label"), "CI");
  assert.equal(filtered(nativeRow), true);
  assert.equal(filtered(window.document.querySelector('nav a[href$="deploy.yml"]').closest("li")), true);
  assert.equal(ci.querySelector("ul").hidden, true);
  assert.equal(ci.querySelector('a[href$="build.yml"]').closest("li").hidden, true);
  assert.equal(ci.querySelector('a[href$="deploy.yml"]').closest("li").hidden, true);
  assert.equal(category(window, "Important").querySelector('a[href$="build.yml"]').closest("li").hidden, true);

  button(ci, "CI").click();
  assert.equal(ci.querySelector("ul").hidden, false);
  assert.equal(ci.querySelector('a[href$="build.yml"]').closest("li").hidden, false);
  assert.equal(window.document.querySelectorAll('.gha-workflow-pinned a[href$="build.yml"], .gha-workflow-category a[href$="build.yml"]').length, 3);
  assert.equal(filtered(nativeRow), true);
  assert.equal(ci.querySelector('a[href$="deploy.yml"]').closest("li").hidden, false);
  button(ci, "CI").click();
  assert.equal(ci.querySelector("ul").hidden, true);
  assert.equal(ci.querySelector('a[href$="build.yml"]').closest("li").hidden, true);
  assert.equal(ci.querySelector('a[href$="deploy.yml"]').closest("li").hidden, true);

  pinTooltip.textContent = "Pin workflow";
  await settle(window);
  assert.equal(filtered(nativeRow), true);
  assert.equal(window.document.querySelector(".gha-workflow-pinned"), null);
  assert.equal(category(window, "CI").querySelector("ul").hidden, true);
  assert.equal(category(window, "Important").querySelector("ul").hidden, true);
  pinTooltip.textContent = "Unpin workflow";
  await settle(window);
  assert.equal(filtered(nativeRow), true);
  assert.ok(window.document.querySelector('.gha-workflow-pinned a[href$="build.yml"]'));
  assert.equal(category(window, "CI").querySelector('a[href$="build.yml"]').closest("li").hidden, true);

  search(window, "deploy");
  assert.equal(filtered(nativeRow), true);
  search(window, "");
  assert.equal(filtered(nativeRow), true);

  const refreshed = await setup(t, markup, "/owner/repo/actions", storage);
  assert.equal(filtered(refreshed.document.querySelector('nav a[href$="build.yml"]').closest("li")), true);
  assert.ok(refreshed.document.querySelector('.gha-workflow-pinned a[href$="build.yml"]'));
  assert.equal(category(refreshed, "CI").querySelector('a[href$="build.yml"]').closest("li").hidden, true);
});

test("shows uncategorized pins in the top section instead of the plain list", async (t) => {
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [{ name: "CI", workflows: ["deploy.yml"], collapsed: true }] };
  const markup = currentSidebar.replace(
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<button aria-label="Unpin Build application"></button>'
  );
  const window = await setup(t, markup, "/owner/repo/actions", storage);
  assert.equal(filtered(window.document.querySelector('nav a[href$="build.yml"]').closest("li")), true);
  assert.ok(window.document.querySelector('.gha-workflow-pinned a[href$="build.yml"]'));
  assert.equal(filtered(window.document.querySelector('nav a[href$="deploy.yml"]').closest("li")), true);
});

test("grouped workflows match native font size and mark the active workflow", async (t) => {
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [{ name: "CI", workflows: ["build.yml"], collapsed: false }] };
  const markup = currentSidebar.replace(
    'href="/owner/repo/actions/workflows/build.yml"',
    'href="/owner/repo/actions/workflows/build.yml" style="font-size: 16px"'
  );
  const window = await setup(t, markup, "/owner/repo/actions/workflows/build.yml", storage);
  const nativeLink = window.document.querySelector('nav a[href$="build.yml"]');
  let grouped = category(window, "CI").querySelector(".gha-workflow-category-row");
  assert.equal(grouped.style.fontSize, window.getComputedStyle(nativeLink).fontSize);
  assert.equal(grouped.hasAttribute("data-gha-active"), true);
  assert.equal(grouped.querySelector("a").getAttribute("aria-current"), "page");

  window.history.pushState({}, "", "/owner/repo/actions/workflows/deploy.yml");
  window.dispatchEvent(new window.PopStateEvent("popstate"));
  await settle(window);
  grouped = category(window, "CI").querySelector(".gha-workflow-category-row");
  assert.equal(grouped.hasAttribute("data-gha-active"), false);

  nativeLink.setAttribute("aria-current", "page");
  await settle(window);
  grouped = category(window, "CI").querySelector(".gha-workflow-category-row");
  assert.equal(grouped.hasAttribute("data-gha-active"), true);
});

test("persists per-repository categories and restores workflows when the last category is deleted", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "CI");
  await assign(window, "CI", "Build application");
  button(category(window, "CI"), "CI").click();
  button(options(window, "CI"), "Rename").click();
  const field = window.document.querySelector('input[aria-label="Category name"]');
  field.value = "Builds";
  button(field.closest("form"), "Save").click();
  await settle(window);
  assert.ok(category(window, "Builds"));
  assert.equal(category(window, "Builds").querySelector("ul").hidden, true);
  assert.equal(category(window, "CI"), undefined);

  const refreshed = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  assert.ok(category(refreshed, "Builds").querySelector('a[href$="build.yml"]'));
  assert.equal(category(refreshed, "Builds").querySelector("ul").hidden, true);
  const otherMarkup = currentSidebar.replaceAll("/owner/repo/", "/owner/other/");
  const other = await setup(t, otherMarkup, "/owner/other/actions", storage);
  assert.equal(category(other, "Builds"), undefined);

  refreshed.confirm = () => true;
  button(options(refreshed, "Builds"), "Delete").click();
  await settle(refreshed);
  assert.equal(category(refreshed, "Builds"), undefined);
  assert.deepEqual(Array.from(storage.data[categoryKey].categories), []);
  assert.equal(filtered(refreshed.document.querySelector('nav a[href$="build.yml"]').closest("li")), false);
});

test("shows category changes as pending until storage confirms them", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  let release;
  let calls = 0;
  storage.local.set = async (value) => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    Object.assign(storage.data, value);
  };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  const picker = window.document.querySelector('nav a[href$="build.yml"]').closest("li")
    .querySelector(".gha-workflow-category-picker");
  picker.querySelector("summary").click();
  button(picker, "CI").click();
  assert.equal(calls, 1, "the first write should start during the click");
  assert.match(window.document.querySelector(".gha-workflow-category-save-status")?.textContent ?? "", /Saving/i);
  const leave = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  assert.equal(leave.defaultPrevented, true);
  release();
  await settle(window);
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), ["build.yml"]);
  assert.equal(window.document.querySelector(".gha-workflow-category-save-status"), null);
});

test("keeps one save message under Categories when pinned workflows are shown", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: ["build.yml"], collapsed: false }] };
  let release;
  let writes = 0;
  storage.local.set = async (value) => {
    if (++writes === 1) await new Promise((resolve) => { release = resolve; });
    Object.assign(storage.data, value);
  };
  const markup = currentSidebar.replace('<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
    '<button aria-label="Unpin Build application"></button>');
  const window = await setup(t, markup, "/owner/repo/actions", storage);
  for (const name of ["Ops", "Release"]) {
    button(window.document, "New category").click();
    const field = window.document.querySelector('input[aria-label="Category name"]');
    field.value = name;
    button(field.closest("form"), "Save").click();
  }
  const root = window.document.querySelector(".gha-workflow-categories");
  const messages = root.querySelectorAll(".gha-workflow-category-save-status");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].parentElement, root);
  assert.equal(messages[0].previousElementSibling.querySelector("h3")?.textContent, "Categories");
  release();
  await settle(window);
  assert.equal(root.querySelector(".gha-workflow-category-save-status"), null);
});

test("saves category collapse without showing a pending message", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  let release;
  storage.local.set = async (value) => {
    await new Promise((resolve) => { release = resolve; });
    Object.assign(storage.data, value);
  };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  button(category(window, "CI"), "CI").click();
  assert.equal(window.document.querySelector(".gha-workflow-category-save-status"), null);
  const leave = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  assert.equal(leave.defaultPrevented, true);
  release();
  await settle(window);
  assert.equal(savedCategory(storage, "CI").collapsed, true);
  assert.equal(window.document.querySelector(".gha-workflow-category-save-status"), null);
});

test("warns if a silent category collapse save fails", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  storage.local.set = async () => {};
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  window.console.warn = () => {};
  button(category(window, "CI"), "CI").click();
  await settle(window);
  assert.match(window.document.querySelector('[role="alert"].gha-workflow-category-save-status')?.textContent ?? "", /not saved/i);
  assert.equal(savedCategory(storage, "CI").collapsed, false);
});

test("dismisses a save warning without treating unsaved categories as saved", async (t) => {
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  storage.local.set = async () => {};
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  window.console.warn = () => {};
  button(category(window, "CI"), "CI").click();
  await settle(window);
  button(window.document.querySelector(".gha-workflow-category-save-status"),
    "Category changes were not saved. Retry before leaving or reloading this tab.").click();
  assert.equal(window.document.querySelector(".gha-workflow-category-save-status"), null);
  const leave = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  assert.equal(leave.defaultPrevented, true);
});

test("keeps failed category changes visible for retry and validates read-back", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  storage.local.set = async () => {};
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  window.console.warn = () => {};
  await assign(window, "CI", "Build application");
  assert.match(window.document.querySelector('[role="alert"].gha-workflow-category-save-status')?.textContent ?? "", /not saved/i);
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), []);
  storage.local.set = async (value) => { Object.assign(storage.data, value); };
  button(window.document, "Retry save").click();
  await settle(window);
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), ["build.yml"]);
  assert.equal(window.document.querySelector(".gha-workflow-category-save-status"), null);
});

test("accepts saved categories when storage reorders category object keys", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  storage.local.get = async (requested) => {
    const keys = Array.isArray(requested) ? requested : [requested];
    return Object.fromEntries(keys.map((item) => [item, item !== key ? storage.data[item] : {
      categories: storage.data[key].categories.map(({ name, workflows, collapsed }) =>
        ({ collapsed, workflows, name })),
    }]));
  };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await assign(window, "CI", "Deploy production");
  await assign(window, "CI", "Build application");
  assert.equal(window.document.querySelector(".gha-workflow-category-save-status"), null);
  button(category(window, "CI"), "CI").click();
  await settle(window);
  assert.equal(window.document.querySelector(".gha-workflow-category-save-status"), null);
  assert.equal(savedCategory(storage, "CI").collapsed, true);
});

test("warns when the extension context rejects a category write", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  storage.local.set = async () => { throw new Error("Extension context invalidated."); };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  window.console.warn = () => {};
  await assign(window, "CI", "Build application");
  assert.match(window.document.querySelector('[role="alert"].gha-workflow-category-save-status')?.textContent ?? "", /not saved/i);
  const leave = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  assert.equal(leave.defaultPrevented, true);
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), []);
  assert.equal([...window.document.querySelectorAll("button")].some((item) => item.textContent === "Retry save"), false);
});

test("keeps an unsaved category draft across same-document navigation", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  storage.local.set = async () => { throw new Error("Extension context invalidated."); };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  window.console.warn = () => {};
  await assign(window, "CI", "Build application");
  window.history.pushState({}, "", "/owner/repo");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle(window);
  const leave = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  assert.equal(leave.defaultPrevented, true);
  window.history.pushState({}, "", "/owner/repo/actions");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle(window);
  assert.ok(category(window, "CI")?.querySelector('a[href$="build.yml"]'));
  assert.match(window.document.querySelector('[role="alert"].gha-workflow-category-save-status')?.textContent ?? "", /not saved/i);
  assert.equal([...window.document.querySelectorAll("button")].some((item) => item.textContent === "Retry save"), false);
});

test("keeps queued category snapshots independent of later renames", async (t) => {
  const storage = mockStorage();
  const key = categoryKey;
  storage.data[key] = { categories: [{ name: "CI", workflows: [], collapsed: false }] };
  const snapshots = [];
  let release;
  storage.local.set = async (value) => {
    snapshots.push(value[key]);
    if (snapshots.length === 1) await new Promise((resolve) => { release = resolve; });
    Object.assign(storage.data, value);
  };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await assign(window, "CI", "Build application");
  button(options(window, "CI"), "Rename").click();
  const field = window.document.querySelector('input[aria-label="Category name"]');
  field.value = "Builds";
  button(field.closest("form"), "Save").click();
  assert.deepEqual(Array.from(snapshots[0].categories[0].workflows), ["build.yml"]);
  release();
  await settle(window);
  assert.equal(savedCategory(storage, "Builds")?.workflows[0], "build.yml");
});

test("remembers each category's collapsed state across reloads", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "CI");
  await createCategory(window, "Deployments");
  button(category(window, "CI"), "CI").click();
  await settle(window);
  assert.equal(savedCategory(storage, "CI").collapsed, true);

  const refreshed = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  assert.equal(category(refreshed, "CI").querySelector("ul").hidden, true);
  assert.equal(button(category(refreshed, "CI"), "CI").getAttribute("aria-expanded"), "false");
  assert.equal(category(refreshed, "Deployments").querySelector("ul").hidden, false);

  button(category(refreshed, "CI"), "CI").click();
  await settle(refreshed);
  assert.equal(savedCategory(storage, "CI").collapsed, false);
  const reopened = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  assert.equal(category(reopened, "CI").querySelector("ul").hidden, false);
});

test("expands and collapses all categories from the icon before New category", async (t) => {
  const storage = mockStorage();
  storage.data[categoryKey] = { categories: [
    { name: "CI", workflows: ["build.yml"], collapsed: true },
    { name: "Deployments", workflows: ["deploy.yml"], collapsed: false },
  ] };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  const actions = window.document.querySelector(".gha-workflow-category-heading-actions");
  assert.deepEqual([...actions.children].map((item) => item.getAttribute("aria-label") ??
    item.querySelector("summary")?.getAttribute("aria-label")),
  ["Expand all categories", "New category", "Category backup options"]);

  button(actions, "Expand all categories").click();
  assert.equal(category(window, "CI").querySelector("ul").hidden, false);
  assert.equal(category(window, "Deployments").querySelector("ul").hidden, false);
  assert.equal(button(window.document, "Collapse all categories").getAttribute("aria-label"),
    "Collapse all categories");
  await settle(window);
  assert.equal(savedCategory(storage, "CI").collapsed, false);

  button(category(window, "CI"), "CI").click();
  assert.ok(button(window.document, "Expand all categories"));
  button(window.document, "Expand all categories").click();
  assert.equal(category(window, "CI").querySelector("ul").hidden, false);

  button(window.document, "Collapse all categories").click();
  assert.equal(category(window, "CI").querySelector("ul").hidden, true);
  assert.equal(category(window, "Deployments").querySelector("ul").hidden, true);
  await settle(window);
  assert.equal(savedCategory(storage, "CI").collapsed, true);
  assert.equal(savedCategory(storage, "Deployments").collapsed, true);

  const refreshed = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  assert.equal(category(refreshed, "CI").querySelector("ul").hidden, true);
  assert.equal(category(refreshed, "Deployments").querySelector("ul").hidden, true);
});

test("exports a versioned backup for the current repository", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "CI");
  await assign(window, "CI", "Build application");
  button(category(window, "CI"), "CI").click();
  await settle(window);
  let downloaded;
  window.URL.createObjectURL = (blob) => { downloaded = blob; return "blob:backup"; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    assert.equal(this.download, "gha-categories-owner-repo.json");
  };
  window.document.querySelector('summary[aria-label="Category backup options"]').click();
  button(window.document, "Export categories").click();
  const backup = await new Promise((resolve) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(JSON.parse(reader.result));
    reader.readAsText(downloaded);
  });
  assert.equal(backup.format, "gha-workflow-categories");
  assert.equal(backup.version, 2);
  assert.equal(backup.repository, "owner/repo");
  assert.deepEqual(backup.categories, [{ name: "CI", workflows: ["build.yml"], collapsed: true }]);
  assert.equal("assignments" in backup, false);
  assert.equal("collapsed" in backup, false);
});

test("migrates V1 saved categories to V2 without removing the old data", async (t) => {
  const storage = mockStorage();
  const oldKey = "ghaWorkflowCategoriesV1:owner/repo";
  const newKey = "ghaWorkflowCategoriesV2:owner/repo";
  storage.data[oldKey] = {
    categories: ["CI", "Release"],
    assignments: { "build.yml": ["CI", "Release"], "unused.yml": [] },
    collapsed: ["Release"],
  };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  assert.ok(category(window, "CI")?.querySelector('a[href$="build.yml"]'));
  assert.equal(category(window, "Release")?.querySelector("ul").hidden, true);
  assert.deepEqual(Array.from(storage.data[newKey].categories, (item) => ({
    name: item.name, workflows: Array.from(item.workflows), collapsed: item.collapsed,
  })), [
    { name: "CI", workflows: ["build.yml"], collapsed: false },
    { name: "Release", workflows: ["build.yml"], collapsed: true },
  ]);
  assert.deepEqual(Array.from(storage.data[oldKey].assignments["unused.yml"]), []);
  const refreshed = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  assert.ok(category(refreshed, "CI")?.querySelector('a[href$="build.yml"]'));
});

test("keeps V1 data available if its V2 migration write fails", async (t) => {
  const storage = mockStorage();
  const oldKey = "ghaWorkflowCategoriesV1:owner/repo";
  storage.data[oldKey] = {
    categories: ["CI"], assignments: { "build.yml": ["CI"] }, collapsed: ["CI"],
  };
  storage.local.set = async () => { throw new Error("Storage unavailable"); };
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage, undefined, (page) => {
    page.console.warn = () => {};
  });
  assert.ok(category(window, "CI")?.querySelector('a[href$="build.yml"]'));
  assert.equal(category(window, "CI")?.querySelector("ul").hidden, true);
  assert.equal(storage.data[categoryKey], undefined);
  assert.deepEqual(Array.from(storage.data[oldKey].assignments["build.yml"]), ["CI"]);
  assert.match(window.document.querySelector(".gha-workflow-category-save-status")?.textContent ?? "", /not saved/i);
});

test("import asks whether to merge or replace, then saves a merged backup across reloads", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "Current");
  await assign(window, "Current", "Build application");
  const backup = {
    format: "gha-workflow-categories", version: 1, repository: "owner/repo",
    categories: ["Current", "Imported"],
    assignments: { "build.yml": ["Imported"], "old.yml": ["Imported"] },
    collapsed: ["Imported"],
  };
  await importCategories(window, backup);
  assert.ok(button(window.document, "Merge"));
  assert.ok(button(window.document, "Replace"));
  assert.ok(button(window.document, "Cancel"));
  assert.equal(category(window, "Imported"), undefined);
  button(window.document, "Merge").click();
  await settle(window);
  const saved = storage.data[categoryKey];
  assert.deepEqual(Array.from(saved.categories, (item) => item.name), ["Current", "Imported"]);
  assert.deepEqual(Array.from(savedCategory(storage, "Current").workflows), ["build.yml"]);
  assert.deepEqual(Array.from(savedCategory(storage, "Imported").workflows), ["build.yml", "old.yml"]);
  assert.equal(savedCategory(storage, "Imported").collapsed, true);
  const refreshed = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  assert.ok(category(refreshed, "Imported"));
  assert.ok(category(refreshed, "Current"));
  assert.equal(category(refreshed, "Imported").querySelector("ul").hidden, true);
});

test("merges V2 category workflows while preserving an existing collapsed choice", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "CI");
  button(category(window, "CI"), "CI").click();
  await settle(window);
  await importCategories(window, {
    format: "gha-workflow-categories", version: 2, repository: "owner/repo",
    categories: [
      { name: "ci", workflows: ["build.yml"], collapsed: false },
      { name: "Release", workflows: ["old.yml"], collapsed: true },
    ],
  });
  button(window.document, "Merge").click();
  await settle(window);
  assert.deepEqual(Array.from(storage.data[categoryKey].categories, (item) => item.name), ["CI", "Release"]);
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), ["build.yml"]);
  assert.equal(savedCategory(storage, "CI").collapsed, true);
  assert.equal(savedCategory(storage, "Release").collapsed, true);
});

test("replace restores the backup snapshot and Cancel leaves existing categories alone", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "Current");
  const backup = {
    format: "gha-workflow-categories", version: 2, repository: "owner/repo",
    categories: [{ name: "Restored", workflows: ["deploy.yml"], collapsed: true }],
  };
  await importCategories(window, backup);
  button(window.document, "Cancel").click();
  assert.ok(category(window, "Current"));
  assert.equal(category(window, "Restored"), undefined);
  await importCategories(window, backup);
  button(window.document, "Replace").click();
  await settle(window);
  assert.equal(category(window, "Current"), undefined);
  assert.ok(category(window, "Restored"));
  assert.deepEqual(Array.from(storage.data[categoryKey].categories, (item) => item.name), ["Restored"]);
});

test("rejects invalid and cross-repository backups without changing saved categories", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "Current");
  const original = JSON.stringify(storage.data[categoryKey]);
  await importCategories(window, {
    format: "gha-workflow-categories", version: 1, repository: "owner/other",
    categories: ["Other"], assignments: {}, collapsed: [],
  });
  assert.match(window.document.querySelector('.gha-workflow-category-import-error')?.textContent ?? "", /repository/i);
  await importCategories(window, {
    format: "gha-workflow-categories", version: 2, repository: "owner/repo",
    categories: [{ name: "Valid", workflows: ["build.yml", "build.yml"], collapsed: false }],
  });
  assert.match(window.document.querySelector('.gha-workflow-category-import-error')?.textContent ?? "", /invalid/i);
  assert.equal(JSON.stringify(storage.data[categoryKey]), original);
});

test("does not report an imported backup as saved when storage read-back fails", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  storage.local.set = async () => {};
  window.console.warn = () => {};
  await importCategories(window, {
    format: "gha-workflow-categories", version: 1, repository: "owner/repo",
    categories: ["Restored"], assignments: {}, collapsed: [],
  });
  button(window.document, "Replace").click();
  await settle(window);
  assert.ok(category(window, "Restored"));
  assert.equal(window.document.querySelector(".gha-workflow-category-import-notice"), null);
  assert.match(window.document.querySelector(".gha-workflow-category-save-status")?.textContent ?? "", /not saved/i);
  assert.equal(storage.data[categoryKey], undefined);
});

test("clears an old import success notice when a later category save fails", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await importCategories(window, {
    format: "gha-workflow-categories", version: 1, repository: "owner/repo",
    categories: ["Restored"], assignments: {}, collapsed: [],
  });
  button(window.document, "Replace").click();
  await settle(window);
  assert.match(window.document.querySelector(".gha-workflow-category-import-notice")?.textContent ?? "", /saved/i);
  storage.local.set = async () => {};
  window.console.warn = () => {};
  button(category(window, "Restored"), "Restored").click();
  await settle(window);
  assert.equal(window.document.querySelector(".gha-workflow-category-import-notice"), null);
  assert.match(window.document.querySelector(".gha-workflow-category-save-status")?.textContent ?? "", /not saved/i);
});

test("clicking import messages dismisses them", async (t) => {
  const window = await setup(t);
  await importCategories(window, {
    format: "gha-workflow-categories", version: 2, repository: "another/repo", categories: [],
  });
  button(window.document.querySelector(".gha-workflow-category-import-error"),
    "This backup belongs to another repository.").click();
  assert.equal(window.document.querySelector(".gha-workflow-category-import-error"), null);
  await importCategories(window, {
    format: "gha-workflow-categories", version: 2, repository: "owner/repo", categories: [],
  });
  button(window.document, "Replace").click();
  await settle(window);
  button(window.document.querySelector(".gha-workflow-category-import-notice"),
    "Categories imported and saved.").click();
  assert.equal(window.document.querySelector(".gha-workflow-category-import-notice"), null);
});

test("merges workflow ids that match inherited object property names", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await importCategories(window, {
    format: "gha-workflow-categories", version: 1, repository: "owner/repo",
    categories: ["Imported"], assignments: { constructor: ["Imported"] }, collapsed: [],
  });
  button(window.document, "Merge").click();
  await settle(window);
  assert.deepEqual(Array.from(savedCategory(storage, "Imported").workflows), ["constructor"]);
});

test("renames a category named new without creating a duplicate", async (t) => {
  const window = await setup(t);
  await createCategory(window, "new");
  button(options(window, "new"), "Rename").click();
  const field = window.document.querySelector('input[aria-label="Category name"]');
  field.value = "Renamed";
  button(field.closest("form"), "Save").click();
  await settle(window);
  assert.equal(category(window, "new"), undefined);
  assert.ok(category(window, "Renamed"));
  assert.equal(window.document.querySelectorAll("[data-gha-category-name]").length, 1);
});

test("creates a category from a workflow's plus menu and assigns that workflow", async (t) => {
  const window = await setup(t);
  const nativeLink = window.document.querySelector('nav a[href$="build.yml"]');
  const nativeRow = nativeLink.closest("li");
  let nativeRowClicks = 0;
  nativeRow.addEventListener("click", () => nativeRowClicks++);
  const picker = nativeRow.querySelector(".gha-workflow-category-picker");
  assert.ok(picker);
  picker.querySelector("summary").click();
  button(picker, "Create new category").click();
  assert.equal(nativeRowClicks, 0);
  const field = window.document.querySelector('input[aria-label="Category name"]');
  field.value = "Builds";
  button(field.closest("form"), "Save").click();
  await settle(window);
  assert.ok(category(window, "Builds").querySelector('a[href$="build.yml"]'));
  assert.equal(filtered(nativeLink.closest("li")), true);
});

test("creating a category from plus keeps unrelated workflow pickers and updates their menus", async (t) => {
  const extras = Array.from({ length: 40 }, (_, index) => workflow(`Extra ${index}`, `extra-${index}.yml`)).join("");
  const markup = currentSidebar.replace(workflow("Deploy production", "deploy.yml"),
    workflow("Deploy production", "deploy.yml") + extras);
  const window = await setup(t, markup);
  const buildPicker = window.document.querySelector('nav a[href$="build.yml"]').closest("li")
    .querySelector(".gha-workflow-category-picker");
  const deployPicker = window.document.querySelector('nav a[href$="deploy.yml"]').closest("li")
    .querySelector(".gha-workflow-category-picker");
  buildPicker.querySelector("summary").click();
  button(buildPicker, "Create new category").click();
  const field = window.document.querySelector('input[aria-label="Category name"]');
  field.value = "Builds";
  button(field.closest("form"), "Save").click();

  assert.equal(window.document.querySelector('nav a[href$="deploy.yml"]').closest("li")
    .querySelector(".gha-workflow-category-picker"), deployPicker);
  deployPicker.querySelector("summary").click();
  assert.ok(button(deployPicker, "Builds"));
});

test("does not mistake a category named Show more for GitHub's workflow loader", async (t) => {
  const window = await setup(t);
  await createCategory(window, "Show more");
  await settle(window);
  assert.equal(category(window, "Show more").querySelector("a"), null);
  assert.equal(filtered(window.document.querySelector('nav a[href$="build.yml"]').closest("li")), false);
});

test("edit lists only assigned workflows and disappears when the category becomes empty", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "CI");
  assert.equal([...options(window, "CI").querySelectorAll("button")]
    .some((item) => item.textContent.trim() === "Edit workflows"), false);
  await assign(window, "CI", "Build application");
  button(options(window, "CI"), "Edit workflows").click();
  let section = category(window, "CI");
  const editor = section.querySelector(".gha-workflow-category-editor");
  assert.deepEqual([...editor.querySelectorAll("label")].map((label) => label.textContent.trim()), ["Build application"]);
  assert.equal(section.querySelector(".gha-workflow-category-list").hidden, true);
  assert.equal(editor.hidden, false);
  assert.equal(button(section, "CI").getAttribute("aria-expanded"), "true");
  assert.equal(section.querySelector(".gha-workflow-category-options"), null);
  assert.equal(button(section.querySelector(".gha-workflow-category-header"), "Save").className,
    "gha-workflow-category-edit-save");
  assert.equal(button(section.querySelector(".gha-workflow-category-header"), "Cancel").className,
    "gha-workflow-category-edit-cancel");
  let checkbox = editor.querySelector('input[type="checkbox"]');
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle(window);
  assert.ok(category(window, "CI").querySelector(".gha-workflow-category-editor"));
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), ["build.yml"]);
  button(category(window, "CI"), "Cancel").click();
  section = category(window, "CI");
  assert.equal(section.querySelector(".gha-workflow-category-list").hidden, false);
  assert.equal(section.querySelector(".gha-workflow-category-editor"), null);
  assert.ok(section.querySelector('a[href$="build.yml"]'));
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), ["build.yml"]);

  button(options(window, "CI"), "Edit workflows").click();
  const resumedEditor = category(window, "CI").querySelector(".gha-workflow-category-editor");
  checkbox = resumedEditor.querySelector('input[type="checkbox"]');
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
  button(category(window, "CI"), "Save").click();
  await settle(window);
  assert.equal(filtered(window.document.querySelector('nav a[href$="build.yml"]').closest("li")), false);
  assert.equal(category(window, "CI").querySelector(".gha-workflow-category-editor"), null);
  assert.equal(window.document.activeElement, button(category(window, "CI"), "CI"));
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), []);
  assert.equal([...options(window, "CI").querySelectorAll("button")]
    .some((item) => item.textContent.trim() === "Edit workflows"), false);
});

test("editing a category stages additions from the plus menu until Save", async (t) => {
  const storage = mockStorage();
  const window = await setup(t, currentSidebar, "/owner/repo/actions", storage);
  await createCategory(window, "CI");
  await assign(window, "CI", "Build application");

  button(options(window, "CI"), "Edit workflows").click();
  await assign(window, "CI", "Deploy production");
  assert.deepEqual([...category(window, "CI").querySelectorAll(".gha-workflow-category-editor label")]
    .map((label) => label.textContent.trim()), ["Build application", "Deploy production"]);
  assert.equal(savedCategory(storage, "CI").workflows.includes("deploy.yml"), false);
  const firstBuild = category(window, "CI").querySelector('.gha-workflow-category-editor input[data-workflow-id="build.yml"]');
  firstBuild.checked = false;
  firstBuild.dispatchEvent(new window.Event("change", { bubbles: true }));
  search(window, "no matching workflow");
  await settle(window);
  assert.equal(category(window, "CI").hidden, false);
  assert.ok(button(category(window, "CI"), "Cancel"));
  button(category(window, "CI"), "Cancel").click();
  search(window, "");
  await settle(window);
  assert.equal(category(window, "CI").querySelector('a[href$="deploy.yml"]'), null);
  assert.ok(category(window, "CI").querySelector('a[href$="build.yml"]'));
  assert.equal(savedCategory(storage, "CI").workflows.includes("deploy.yml"), false);

  button(options(window, "CI"), "Edit workflows").click();
  await assign(window, "CI", "Deploy production");
  const build = category(window, "CI").querySelector('.gha-workflow-category-editor input[data-workflow-id="build.yml"]');
  build.checked = false;
  build.dispatchEvent(new window.Event("change", { bubbles: true }));
  button(category(window, "CI"), "Save").click();
  await settle(window);
  assert.ok(category(window, "CI").querySelector('a[href$="deploy.yml"]'));
  assert.equal(category(window, "CI").querySelector('a[href$="build.yml"]'), null);
  assert.deepEqual(Array.from(savedCategory(storage, "CI").workflows), ["deploy.yml"]);
});

test("keeps grouped links live after GitHub replaces the sidebar and finds later workflows", async (t) => {
  const window = await setup(t);
  await createCategory(window, "CI");
  await assign(window, "CI", "Build application");
  const list = window.document.querySelector('li[data-component="ActionList.Group"] ul');
  list.insertAdjacentHTML("beforeend", workflow("Lint", "lint.yml"));
  await settle(window);
  await assign(window, "CI", "Lint");
  assert.ok(category(window, "CI").querySelector('a[href$="lint.yml"]'));

  const oldLink = window.document.querySelector('nav a[href$="build.yml"]');
  let oldClicks = 0;
  oldLink.addEventListener("click", (event) => { event.preventDefault(); oldClicks++; });
  const replacement = window.document.createElement("template");
  replacement.innerHTML = currentSidebar;
  const newNav = replacement.content.querySelector("nav");
  let newClicks = 0;
  newNav.querySelector('a[href$="build.yml"]').addEventListener("click", (event) => {
    event.preventDefault();
    newClicks++;
  });
  window.document.querySelector("nav").replaceWith(newNav);
  await settle(window);
  assert.ok(newNav.querySelector('a[href$="build.yml"]').closest("li")
    .querySelector(".gha-workflow-category-picker"));
  category(window, "CI").querySelector('a[href$="build.yml"]').click();
  assert.equal(oldClicks, 0);
  assert.equal(newClicks, 1);
  assert.equal(filtered(newNav.querySelector('a[href$="build.yml"]').closest("li")), true);

  const edit = button(options(window, "CI"), "Edit workflows");
  assert.equal(edit.getAttribute("aria-label"), "Edit workflows in CI");
  edit.click();
  const editor = category(window, "CI").querySelector(".gha-workflow-category-editor");
  assert.deepEqual([...editor.querySelectorAll("label")].map((label) => label.textContent.trim()), ["Build application"]);
  assert.equal(window.document.activeElement, editor.querySelector('input[type="checkbox"]'));

  button(category(window, "CI"), "CI").click();
  assert.equal(category(window, "CI").querySelector("ul").hidden, true);
  assert.equal(category(window, "CI").querySelector(".gha-workflow-category-editor").hidden, true);
  button(category(window, "CI"), "CI").click();
  assert.equal(category(window, "CI").querySelector("ul").hidden, true);
  assert.equal(category(window, "CI").querySelector(".gha-workflow-category-editor").hidden, false);
  assert.equal(button(category(window, "CI"), "CI").getAttribute("aria-expanded"), "true");
  button(category(window, "CI"), "CI").click();
  search(window, "build");
  assert.equal(category(window, "CI").querySelector("ul").hidden, true);
  assert.equal(category(window, "CI").querySelector(".gha-workflow-category-editor").hidden, true);
});

test("reattaches after React replaces the sidebar and preserves the current query", async (t) => {
  const window = await setup(t);
  search(window, "deploy");
  window.history.pushState({}, "", "/owner/repo/actions/workflows/deploy.yml");
  const template = window.document.createElement("template");
  template.innerHTML = currentSidebar;
  window.document
    .querySelector("nav")
    .replaceWith(template.content.querySelector("nav"));
  await settle(window);
  assert.equal(
    window.document.querySelectorAll('input[aria-label="Filter workflows"]')
      .length,
    1
  );
  assert.equal(input(window).value, "deploy");
  assert.equal(
    filtered(
      window.document.querySelector('nav a[href$="build.yml"]').closest("li")
    ),
    true
  );
});

test("initializes when navigating from Code to Actions without a full page load", async (t) => {
  const window = await setup(t, "<main>Code</main>", "/owner/repo");
  assert.equal(input(window), null);
  window.history.pushState({}, "", "/owner/repo/actions");
  window.document.body.innerHTML = currentSidebar;
  await settle(window);
  assert.ok(input(window));
});

test("filters workflows appended later and avoids duplicate inputs on unrelated mutations", async (t) => {
  const window = await setup(t);
  search(window, "deploy");
  window.document
    .querySelector('li[data-component="ActionList.Group"] ul')
    .insertAdjacentHTML("beforeend", workflow("Lint", "lint.yml"));
  window.document.querySelector("main").append("Updated runs");
  await settle(window);
  assert.equal(
    filtered(
      window.document.querySelector('a[href$="lint.yml"]').closest("li")
    ),
    true
  );
  assert.equal(
    window.document.querySelectorAll('input[aria-label="Filter workflows"]')
      .length,
    1
  );
});

test("ignores log row mutations but still updates for sidebar changes", async (t) => {
  const window = await setup(t, currentSidebar, "/owner/repo/actions/runs/123/job/456");
  const logs = window.document.createElement("div");
  logs.className = "js-full-logs-container";
  window.document.body.append(logs);
  await settle(window);

  const originalFrame = window.requestAnimationFrame.bind(window);
  let frames = 0;
  window.requestAnimationFrame = (callback) => {
    frames++;
    return originalFrame(callback);
  };
  for (let i = 0; i < 100; i++) {
    logs.append(window.document.createElement("div"));
  }
  await settle(window);
  assert.equal(frames, 0);

  search(window, "deploy");
  window.document
    .querySelector('li[data-component="ActionList.Group"] ul')
    .insertAdjacentHTML("beforeend", workflow("Lint", "lint.yml"));
  await settle(window);
  assert.ok(frames > 0);
  assert.equal(
    filtered(window.document.querySelector('a[href$="lint.yml"]').closest("li")),
    true
  );
});

test("supports the original custom element and keeps existing row event handlers", async (t) => {
  const window = await setup(
    t,
    `<actions-workflow-list><ul data-target="nav-list.topLevelList"><li>All workflows</li><li><action-list><ul>${workflow(
      "Build",
      "build.yml"
    )}${workflow(
      "Deploy",
      "deploy.yml"
    )}</ul></action-list></li></ul></actions-workflow-list>`
  );
  let clicked = false;
  const link = window.document.querySelector('a[href$="deploy.yml"]');
  link.addEventListener("click", (event) => {
    event.preventDefault();
    clicked = true;
  });
  search(window, "deploy");
  link.click();
  assert.equal(clicked, true);
  assert.equal(
    filtered(
      window.document.querySelector('a[href$="build.yml"]').closest("li")
    ),
    true
  );
});

test("expands Show more workflows once and filters the revealed rows", async (t) => {
  const window = await setup(t, "");
  window.document.body.innerHTML = currentSidebar;
  const list = window.document.querySelector(
    'li[data-component="ActionList.Group"] ul'
  );
  const button = window.document.createElement("button");
  button.textContent = "Show more workflows...";
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks++;
    list.insertAdjacentHTML("beforeend", workflow("Lint", "lint.yml"));
    button.parentElement.hidden = true;
  });
  const row = window.document.createElement("li");
  row.append(button);
  list.append(row);
  await settle(window);
  search(window, "deploy");
  await settle(window);
  assert.equal(clicks, 1);
  assert.equal(
    filtered(list.querySelector('a[href$="lint.yml"]').closest("li")),
    true
  );
});

test("reuses the stored workflow list for three page reloads before refreshing", async (t) => {
  const storage = mockStorage();
  let requests = 0;
  const fetch = async () => {
    requests++;
    return { ok: true, json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [{ id: 3, name: `Lint version ${requests}`, path: ".github/workflows/lint.yml" }],
      totalCount: 1,
    } } }) };
  };
  for (let load = 1; load <= 5; load++) {
    const window = await setup(t, currentSidebar, "/owner/repo/actions", storage, fetch);
    const expectedVersion = load === 5 ? 2 : 1;
    assert.equal(requests, expectedVersion);
    assert.equal(window.document.querySelector('.gha-workflow-api-row a[href$="lint.yml"]')?.textContent,
      `Lint version ${expectedVersion}`);
  }
});

test("fetches missing workflows for filtering and replaces temporary rows with native ones", async (t) => {
  const pages = [
    { workflows: [
      { id: 1, name: "Build application", path: ".github/workflows/build.yml", state: "active" },
      { id: 2, name: "Deploy production", path: ".github/workflows/deploy.yml", state: "active" },
    ], totalCount: 3 },
    { workflows: [
      { id: 3, name: "Lint checks", path: ".github/workflows/lint.yml", state: "active" },
    ], totalCount: 3 },
  ];
  const requests = [];
  const window = await setup(t, currentSidebar, "/owner/repo/actions", mockStorage(), async (url) => {
    requests.push(url);
    const page = Number(new URL(url, "https://github.com").searchParams.get("page"));
    return { ok: true, json: async () => ({ payload: { workflowsSidebarRoute: pages[page - 1] } }) };
  });
  assert.deepEqual(requests.map((url) => Number(new URL(url, "https://github.com").searchParams.get("page"))), [1, 2]);
  search(window, "lint");
  await settle(window);
  const temporary = window.document.querySelector('.gha-workflow-api-list a[href$="lint.yml"]');
  assert.ok(temporary, "a fetched workflow should be searchable before GitHub renders its row");
  assert.equal(temporary.closest("li").hasAttribute("data-gha-workflow-hidden"), false);
  await createCategory(window, "CI");
  temporary.closest("li").querySelector(".gha-workflow-category-picker summary").click();
  button(temporary.closest("li"), "CI").click();
  assert.ok(category(window, "CI").querySelector('a[href$="lint.yml"]'));

  const list = window.document.querySelector('li[data-component="ActionList.Group"] ul');
  list.insertAdjacentHTML("beforeend", workflow("Lint checks", "lint.yml"));
  await settle(window);
  assert.equal(window.document.querySelector('.gha-workflow-api-list a[href$="lint.yml"]'), null);
  assert.ok(list.querySelector('a[href$="lint.yml"]'));
});

test("marks disabled fetched workflows in the plain and category lists", async (t) => {
  const window = await setup(t, currentSidebar, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [
        { id: 1, name: "Lint checks", path: ".github/workflows/lint.yml", state: "disabled_manually" },
        { id: 2, name: "Deploy checks", path: ".github/workflows/checks.yml", state: "active" },
      ], totalCount: 2,
    } } }),
  }));
  const disabled = window.document.querySelector('.gha-workflow-api-row a[href$="lint.yml"]');
  const active = window.document.querySelector('.gha-workflow-api-row a[href$="checks.yml"]');
  assert.equal(disabled.getAttribute("data-gha-workflow-disabled"), "");
  assert.equal(disabled.getAttribute("aria-label"), "Lint checks, disabled workflow");
  assert.equal(disabled.textContent, "Lint checks");
  assert.equal(active.hasAttribute("data-gha-workflow-disabled"), false);

  await createCategory(window, "CI");
  disabled.closest("li").querySelector(".gha-workflow-category-picker summary").click();
  button(disabled.closest("li"), "CI").click();
  const grouped = category(window, "CI").querySelector('a[href$="lint.yml"]');
  assert.equal(grouped.getAttribute("data-gha-workflow-disabled"), "");
  assert.equal(grouped.getAttribute("aria-label"), "Lint checks, disabled workflow");
});

test("pins an API-loaded workflow through GitHub's native control on demand", async (t) => {
  const markup = currentSidebar.replace(
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>',
    '<a href="/owner/repo/actions/workflows/build.yml">Build application</a>' +
      '<button aria-label="Pin Build application"><svg viewBox="0 0 16 16"></svg></button>'
  ).replace("</nav>", "<button id=more>Show more</button></nav>");
  let moreClicks = 0;
  let pinClicks = 0;
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [
        { id: 1, name: "Build application", path: ".github/workflows/build.yml", state: "active" },
        { id: 2, name: "Lint checks", path: ".github/workflows/lint.yml", state: "active" },
      ], totalCount: 2,
    } } }),
  }), (page) => {
    const list = page.document.querySelector('li[data-component="ActionList.Group"] ul');
    page.document.getElementById("more").addEventListener("click", () => {
      moreClicks++;
      const row = page.document.createElement("li");
      row.innerHTML = '<a href="/owner/repo/actions/workflows/lint.yml">Lint checks</a>' +
        '<button aria-label="Pin Lint checks"></button>';
      row.querySelector("button").addEventListener("click", () => { pinClicks++; });
      list.append(row);
    });
  });
  const apiRow = window.document.querySelector('.gha-workflow-api-row a[href$="lint.yml"]').closest("li");
  const pin = apiRow.querySelector('button[aria-label="Pin Lint checks"]');
  assert.ok(pin, "API-loaded workflows should offer a pin control");
  assert.ok(pin.querySelector("svg"), "the control should use GitHub's pin icon");
  assert.equal(moreClicks, 0, "native rows should load only after pinning");
  assert.equal(window.document.getElementById("more").classList.contains("gha-workflow-show-more-hidden"), true);

  await createCategory(window, "CI");
  apiRow.querySelector(".gha-workflow-category-picker summary").click();
  button(apiRow, "CI").click();
  const categoryPin = category(window, "CI").querySelector('.gha-workflow-category-pin[aria-label="Pin Lint checks"]');
  assert.ok(categoryPin, "categorized API workflows should offer the same control");
  categoryPin.click();
  await settle(window);
  assert.equal(moreClicks, 1, "stop loading once the matching native row appears");
  assert.equal(pinClicks, 1);
  assert.equal(window.document.querySelector('.gha-workflow-api-row a[href$="lint.yml"]'), null);
});

test("waits for Show more progress before requesting another page for a pin", async (t) => {
  const markup = currentSidebar.replace("</nav>", "<button id=more>Show more</button></nav>");
  let moreClicks = 0;
  let pinClicks = 0;
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [
        { id: 1, name: "Build application", path: ".github/workflows/build.yml" },
        { id: 2, name: "Lint checks", path: ".github/workflows/lint.yml" },
      ], totalCount: 2,
    } } }),
  }), (page) => {
    const list = page.document.querySelector('li[data-component="ActionList.Group"] ul');
    page.document.getElementById("more").addEventListener("click", () => {
      moreClicks++;
      if (moreClicks > 2) return;
      const file = moreClicks === 1 ? "other.yml" : "lint.yml";
      page.setTimeout(() => {
        const row = page.document.createElement("li");
        row.innerHTML = `<a href="/owner/repo/actions/workflows/${file}">${file}</a>` +
          `<button aria-label="Pin ${file}"></button>`;
        row.querySelector("button").addEventListener("click", () => { pinClicks++; });
        list.append(row);
      }, 120);
    });
  });
  window.document.querySelector('.gha-workflow-api-row button[aria-label="Pin Lint checks"]').click();
  await new Promise((resolve) => window.setTimeout(resolve, 320));
  assert.equal(moreClicks, 2, "the same button should be reused only after a new row appears");
  assert.equal(pinClicks, 1);
});

test("continues loading pages when GitHub briefly removes Show more", async (t) => {
  const markup = currentSidebar.replace("</nav>", "<button id=more>Show more</button></nav>");
  let moreClicks = 0;
  let pinClicks = 0;
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [
        { id: 1, name: "Build application", path: ".github/workflows/build.yml" },
        { id: 2, name: "Other checks", path: ".github/workflows/other.yml" },
        { id: 3, name: "Parallel versioning", path: ".github/workflows/parallel.yml" },
      ], totalCount: 3,
    } } }),
  }), (page) => {
    const list = page.document.querySelector('li[data-component="ActionList.Group"] ul');
    const more = page.document.getElementById("more");
    more.addEventListener("click", () => {
      moreClicks++;
      more.remove();
      page.setTimeout(() => {
        const file = moreClicks === 1 ? "other.yml" : "parallel.yml";
        const row = page.document.createElement("li");
        row.innerHTML = `<a href="/owner/repo/actions/workflows/${file}">${file}</a>` +
          `<button aria-label="Pin ${file}"></button>`;
        row.querySelector("button").addEventListener("click", () => { pinClicks++; });
        list.append(row);
        if (moreClicks === 1) list.closest("nav").append(more);
      }, 120);
    });
  });
  window.document.querySelector('.gha-workflow-api-row a[href$="parallel.yml"]')
    .closest("li").querySelector(".gha-workflow-api-pin").click();
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  assert.equal(pinClicks, 1);
});

test("queues a second API pin while the first native workflow is loading", async (t) => {
  const markup = currentSidebar.replace("</nav>", "<button id=more>Show more</button></nav>");
  const pinned = [];
  let moreClicks = 0;
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [
        { id: 1, name: "Build application", path: ".github/workflows/build.yml" },
        { id: 2, name: "Lint checks", path: ".github/workflows/lint.yml" },
        { id: 3, name: "Deploy checks", path: ".github/workflows/checks.yml" },
      ], totalCount: 3,
    } } }),
  }), (page) => {
    const list = page.document.querySelector('li[data-component="ActionList.Group"] ul');
    page.document.getElementById("more").addEventListener("click", () => {
      const file = ++moreClicks === 1 ? "lint.yml" : "checks.yml";
      page.setTimeout(() => {
        const row = page.document.createElement("li");
        row.innerHTML = `<a href="/owner/repo/actions/workflows/${file}">${file}</a>` +
          `<button aria-label="Pin ${file}"></button>`;
        row.querySelector("button").addEventListener("click", () => pinned.push(file));
        list.append(row);
      }, 120);
    });
  });
  const apiRows = window.document.querySelectorAll(".gha-workflow-api-row");
  apiRows[0].querySelector(".gha-workflow-api-pin").click();
  apiRows[1].querySelector(".gha-workflow-api-pin").click();
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  assert.deepEqual(pinned, ["lint.yml", "checks.yml"]);
});

test("does not auto-expand Show more after the workflow index succeeds", async (t) => {
  const markup = currentSidebar.replace("</nav>", "<button>Show more</button></nav>");
  let clicks = 0;
  const window = await setup(t, markup, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: { workflows: [], totalCount: 0 } } }),
  }), (page) => {
    page.document.querySelector('nav[aria-label="Actions workflows"] button')
      .addEventListener("click", () => { clicks++; });
  });
  await settle(window);
  assert.equal(clicks, 0);
  assert.equal(window.document.querySelector(".gha-workflow-loading").hidden, true);
});

test("indexes dynamic workflows using GitHub's native route", async (t) => {
  const window = await setup(t, currentSidebar, "/owner/repo/actions", mockStorage(), async () => ({
    ok: true,
    json: async () => ({ payload: { workflowsSidebarRoute: {
      workflows: [{ id: 4, name: "Agent", path: "dynamic/agents/code-agent", state: "active" }],
      totalCount: 1,
    } } }),
  }));
  const selector = '.gha-workflow-api-list a[href="/owner/repo/actions/workflows/agents/code-agent"]';
  assert.ok(window.document.querySelector(selector));
  const list = window.document.querySelector('li[data-component="ActionList.Group"] ul');
  list.insertAdjacentHTML("beforeend", workflow("Agent", "agents/code-agent"));
  await settle(window);
  assert.equal(window.document.querySelector(selector), null);
});

test("uses GitHub's Show more loader when the workflow request fails", async (t) => {
  const window = await setup(t, currentSidebar, "/owner/repo/actions", mockStorage(),
    async () => ({ ok: false, status: 403 }));
  const list = window.document.querySelector('li[data-component="ActionList.Group"] ul');
  const more = window.document.createElement("button");
  more.textContent = "Show more";
  let clicks = 0;
  more.addEventListener("click", () => {
    clicks++;
    list.insertAdjacentHTML("beforeend", workflow("Lint checks", "lint.yml"));
    more.remove();
  });
  list.append(more);
  await settle(window);
  assert.equal(clicks, 1);
  assert.ok(list.querySelector('a[href$="lint.yml"]'));
  assert.equal(window.document.querySelector(".gha-workflow-api-list"), null);
  assert.equal(more.classList.contains("gha-workflow-show-more-hidden"), false);
});

test("ignores a workflow response after switching repositories", async (t) => {
  let finishOld;
  const oldResponse = new Promise((resolve) => { finishOld = resolve; });
  const response = (workflows) => ({ ok: true, json: async () => ({
    payload: { workflowsSidebarRoute: { workflows, totalCount: workflows.length } },
  }) });
  const window = await setup(t, currentSidebar, "/owner/repo/actions", mockStorage(),
    (url) => url.includes("/owner/repo/") ? oldResponse : Promise.resolve(response([])));
  window.history.pushState({}, "", "/owner/another/actions");
  window.document.body.innerHTML = currentSidebar.replaceAll("/owner/repo/", "/owner/another/");
  await settle(window);
  finishOld(response([{ id: 3, name: "Old workflow", path: ".github/workflows/old.yml", state: "active" }]));
  await settle(window);
  assert.equal(window.document.querySelector('a[href*="/owner/repo/actions/workflows/old.yml"]'), null);
});

test("resets the query when switching repositories and removes the filter on other pages", async (t) => {
  const window = await setup(t);
  search(window, "deploy");
  window.history.pushState({}, "", "/owner/another/actions");
  window.document.body.innerHTML = currentSidebar.replaceAll(
    "/owner/repo/",
    "/owner/another/"
  );
  await settle(window);
  assert.equal(input(window).value, "");
  window.history.pushState({}, "", "/owner/another/issues");
  window.document.body.append("Issues");
  await settle(window);
  assert.equal(input(window), null);
  assert.equal(
    window.document.querySelector("[data-gha-workflow-hidden]"),
    null
  );
  assert.equal(window.document.querySelector("[data-gha-workflow-add-native]"), null);
});

for (const label of ["Show more", "Show more workflows..."]) {
  test(`clicks ${label} and keeps loading batches through the same button`, async (t) => {
    const window = await setup(t);
    const list = window.document.querySelector(
      'li[data-component="ActionList.Group"] ul'
    );
    const button = window.document.createElement("button");
    button.textContent = label;
    const row = window.document.createElement("li");
    row.append(button);
    let batch = 0;
    button.addEventListener("click", () => {
      button.disabled = true;
      window.setTimeout(() => {
        batch++;
        list.insertAdjacentHTML(
          "beforeend",
          workflow(
            batch === 1 ? "Lint" : "Deploy staging",
            `batch-${batch}.yml`
          )
        );
        button.disabled = false;
        if (batch === 2) row.remove();
      }, 5);
    });
    search(window, "deploy");
    list.append(row);
    await settle(window);
    await settle(window);
    const staging = list.querySelector('a[href$="batch-2.yml"]');
    assert.ok(staging, "workflows from the last batch must be loaded");
    assert.equal(filtered(staging.closest("li")), false);
    assert.equal(
      filtered(list.querySelector('a[href$="batch-1.yml"]').closest("li")),
      true
    );
  });
}

test("retries Show more with a delay without starting duplicate loops", async (t) => {
  const window = await setup(t);
  const button = window.document.createElement("button");
  button.textContent = "Show more workflows...";
  const clickTimes = [];
  button.addEventListener("click", () => {
    clickTimes.push(window.performance.now());
    window.document.querySelector("main").append("Loading");
    if (clickTimes.length === 3) button.hidden = true;
  });
  window.document.querySelector("nav").append(button);
  await settle(window);
  window.document.querySelector("main").append("Updated runs");
  search(window, "deploy");
  await settle(window);
  await settle(window);
  assert.equal(clickTimes.length, 3);
  assert.ok(clickTimes[1] - clickTimes[0] >= 45);
  assert.ok(clickTimes[2] - clickTimes[1] >= 45);
});

for (const attribute of ["aria-disabled", "data-loading"]) {
  test(`waits for GitHub's nested Show more button to clear ${attribute}`, async (t) => {
    const window = await setup(t);
    const sidebar = window.document.querySelector("nav");
    sidebar.insertAdjacentHTML(
      "beforeend",
      '<button aria-disabled="false" data-component="Button" type="button" class="prc-Button-ButtonBase-9n-Xk" data-block="block" data-loading="false" data-no-visuals="true" data-size="small" data-variant="invisible"><span data-component="buttonContent" data-align="start" class="prc-Button-ButtonContent-Iohp5"><span data-component="text" class="prc-Button-Label-FWkx3"><span class="color-fg-muted f6">Show more</span></span></span></button>'
    );
    const button = sidebar.querySelector('button[data-component="Button"]');
    button.setAttribute(attribute, "true");
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks++;
      button.hidden = true;
    });
    await settle(window);
    assert.equal(clicks, 0, "must not click a disabled or loading button");
    button.setAttribute(attribute, "false");
    await settle(window);
    assert.equal(clicks, 1, "must expand once the button becomes ready");
  });
}

for (const change of ["remove sidebar", "leave Actions"]) {
  test(`stops expanding when we ${change}`, async (t) => {
    const window = await setup(t);
    const sidebar = window.document.querySelector("nav");
    const button = window.document.createElement("button");
    button.textContent = "Show more";
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks++;
      if (change === "remove sidebar") sidebar.remove();
      else window.history.pushState({}, "", "/owner/repo/issues");
    });
    sidebar.append(button);
    await settle(window);
    await settle(window);
    assert.equal(clicks, 1);
    if (change === "remove sidebar") {
      for (let tick = 0; tick < 9; tick++) await settle(window);
      assert.equal(window.document.querySelector(".gha-workflow-filter"), null);
    }
  });
}

test("starts expansion for another repository when navigation reuses the sidebar", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  const button = window.document.createElement("button");
  button.textContent = "Show more";
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks++;
    if (clicks === 1) {
      window.history.pushState({}, "", "/owner/another/actions");
      sidebar.querySelectorAll("a").forEach((link) => {
        link.href = link.href.replace("/owner/repo/", "/owner/another/");
      });
    } else button.hidden = true;
  });
  search(window, "deploy");
  sidebar.append(button);
  await settle(window);
  await settle(window);
  await settle(window);
  assert.equal(clicks, 2);
  assert.equal(input(window).value, "");
});

for (const completion of ["removed", "hidden"]) {
  test(`shows loading until Show more is ${completion}, then scrolls the sidebar and page to the top`, async (t) => {
    const window = await setup(t);
    const sidebar = window.document.querySelector("nav");
    const scroller = window.document.querySelector(".workflow-scroll");
    scroller.scrollTop = 300;
    window.document.documentElement.scrollTop = 600;
    const button = window.document.createElement("button");
    button.textContent = "Show more";
    button.setAttribute("data-loading", "true");
    sidebar.append(button);
    input(window).focus();
    await settle(window);
    const status = scroller.querySelector('[role="status"]');
    assert.ok(status);
    assert.equal(status.textContent, "Loading workflows…");
    assert.ok(scroller.querySelector(".gha-workflow-filter").contains(status));
    assert.equal(scroller.scrollTop, 300);
    window.document.querySelector("main").append("Updated runs");
    await settle(window);
    assert.equal(scroller.querySelectorAll('[role="status"]').length, 1);
    if (completion === "removed") button.remove();
    else button.hidden = true;
    for (let tick = 0; tick < 9; tick++) await settle(window);
    assert.equal(scroller.querySelector('[role="status"]'), status);
    assert.equal(status.hidden, true);
    assert.equal(scroller.scrollTop, 0);
    assert.equal(window.document.documentElement.scrollTop, 0);
    assert.equal(window.document.activeElement, input(window));
    scroller.scrollTop = 200;
    search(window, "deploy");
    await settle(window);
    assert.equal(
      scroller.scrollTop,
      200,
      "do not scroll again during later searches"
    );
  });
}

test("removes the loading banner without scrolling when navigation interrupts expansion", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  sidebar.style.overflowY = "auto";
  sidebar.scrollTop = 300;
  const button = window.document.createElement("button");
  button.textContent = "Show more";
  button.disabled = true;
  sidebar.append(button);
  await settle(window);
  assert.ok(window.document.querySelector('[role="status"]'));
  window.history.pushState({}, "", "/owner/repo/issues");
  await settle(window);
  assert.equal(window.document.querySelector('[role="status"]'), null);
  assert.equal(sidebar.scrollTop, 300);
});

test("keeps the search field and loading banner mounted while GitHub replaces the workflow navigation", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  const button = window.document.createElement("button");
  button.textContent = "Show more";
  button.disabled = true;
  sidebar.append(button);
  search(window, "deploy");
  const originalInput = input(window);
  originalInput.focus();
  await settle(window);
  const originalStatus = window.document.querySelector('[role="status"]');
  assert.ok(originalStatus);
  for (let batch = 1; batch <= 2; batch++) {
    window.document.querySelector(
      "nav"
    ).outerHTML = `<nav aria-label="Actions workflows"><ul>${workflow(
      "Deploy staging",
      `batch-${batch}.yml`
    )}</ul><button disabled>Show more</button></nav>`;
    await settle(window);
    assert.equal(
      input(window),
      originalInput,
      "the search field must not be recreated"
    );
    assert.equal(window.document.activeElement, originalInput);
    assert.equal(
      window.document.querySelector('[role="status"]'),
      originalStatus
    );
    assert.equal(
      window.document.querySelectorAll(".gha-workflow-filter").length,
      1
    );
    assert.equal(input(window).value, "deploy");
  }
});

test("keeps loading through a temporary absence of Show more and scrolls after expiration", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  sidebar.style.overflowY = "auto";
  sidebar.scrollTop = 300;
  const button = window.document.createElement("button");
  button.textContent = "Show more";
  button.disabled = true;
  sidebar.append(button);
  await settle(window);
  const status = window.document.querySelector('[role="status"]');
  assert.ok(status);
  button.remove();
  await settle(window);
  assert.equal(window.document.querySelector('[role="status"]'), status);
  assert.equal(
    sidebar.scrollTop,
    300,
    "a temporary gap must not scroll the list"
  );
  sidebar.append(button);
  await settle(window);
  assert.equal(window.document.querySelector('[role="status"]'), status);
  button.remove();
  for (let tick = 0; tick < 9; tick++) await settle(window);
  assert.equal(window.document.querySelector('[role="status"]'), status);
  assert.equal(status.hidden, true);
  assert.equal(sidebar.scrollTop, 0);
});

for (const expanded of [false, true]) {
  test(`cleans up idle controls after navigation is removed${
    expanded ? " following expansion" : " without expansion"
  }`, async (t) => {
    const window = await setup(t);
    const sidebar = window.document.querySelector("nav");
    if (expanded) {
      const button = window.document.createElement("button");
      button.textContent = "Show more";
      button.addEventListener("click", () => button.remove());
      sidebar.append(button);
      for (let tick = 0; tick < 9; tick++) await settle(window);
      assert.equal(
        window.document.querySelector('[role="status"]').hidden,
        true
      );
    }
    sidebar.remove();
    for (let tick = 0; tick < 9; tick++) await settle(window);
    assert.equal(input(window), null);
    assert.equal(window.document.querySelector(".gha-workflow-categories"), null);
  });
}

test("keeps the idle search field through a temporary navigation removal", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  const parent = sidebar.parentElement;
  const originalInput = input(window);
  originalInput.focus();
  sidebar.remove();
  await settle(window);
  assert.equal(input(window), originalInput);
  parent.append(sidebar);
  for (let tick = 0; tick < 5; tick++) await settle(window);
  assert.equal(input(window), originalInput);
  assert.equal(window.document.activeElement, originalInput);
});

test("mounts loading with the search field initially and hides it in place after the timeout", async (t) => {
  const window = await setup(t);
  const originalInput = input(window);
  const status = window.document.querySelector(".gha-workflow-loading");
  assert.ok(status, "loading must be created before any Show more click");
  assert.equal(status.hidden, false);
  await new Promise((resolve) => window.setTimeout(resolve, 550));
  assert.equal(window.document.querySelector(".gha-workflow-loading"), status);
  assert.equal(status.hidden, true);
  assert.equal(input(window), originalInput);
});

test("extends loading expiration on each click and keeps the same controls across button gaps", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  const originalInput = input(window);
  const status = window.document.querySelector(".gha-workflow-loading");
  assert.ok(status);
  const button = window.document.createElement("button");
  button.textContent = "Show more";
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks++;
    button.disabled = true;
  });
  sidebar.append(button);
  await settle(window);
  assert.equal(clicks, 1);
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  button.disabled = false;
  await settle(window);
  assert.equal(clicks, 2);
  button.remove();
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  assert.equal(
    status.hidden,
    false,
    "the second click must extend the timeout"
  );
  assert.equal(window.document.querySelector(".gha-workflow-loading"), status);
  assert.equal(input(window), originalInput);
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  assert.equal(status.hidden, true);
  assert.equal(window.document.querySelector(".gha-workflow-loading"), status);
  assert.equal(input(window), originalInput);
});

test("scrolls once when the final batch finishes after loading expiration", async (t) => {
  const window = await setup(t);
  const sidebar = window.document.querySelector("nav");
  const scroller = window.document.querySelector(".workflow-scroll");
  scroller.scrollTop = 300;
  const button = window.document.createElement("button");
  button.textContent = "Show more";
  button.addEventListener("click", () => {
    button.disabled = true;
    window.setTimeout(() => button.remove(), 700);
  });
  sidebar.append(button);
  await new Promise((resolve) => window.setTimeout(resolve, 600));
  assert.equal(
    window.document.querySelector(".gha-workflow-loading").hidden,
    true
  );
  assert.equal(scroller.scrollTop, 300);
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  assert.equal(button.isConnected, false);
  assert.equal(scroller.scrollTop, 0);
  scroller.scrollTop = 200;
  search(window, "deploy");
  await settle(window);
  assert.equal(scroller.scrollTop, 200);
});

for (const overflow of ["auto", "hidden"]) {
  test(`scrolls outer ${overflow} containers and the page to the top when expansion finishes`, async (t) => {
    const window = await setup(t);
    const sidebar = window.document.querySelector("nav");
    const inner = window.document.querySelector(".workflow-scroll");
    const outer = window.document.createElement("div");
    outer.style.overflowY = overflow;
    inner.before(outer);
    outer.append(inner);
    outer.scrollTop = 300;
    window.document.documentElement.scrollTop = 600;
    const button = window.document.createElement("button");
    button.textContent = "Show more";
    button.addEventListener("click", () => button.remove());
    sidebar.append(button);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    assert.equal(inner.scrollTop, 0);
    assert.equal(
      outer.scrollTop,
      0,
      "the first overflow container may not own the visible scroll"
    );
    assert.equal(window.document.documentElement.scrollTop, 0);
  });
}
