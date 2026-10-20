const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM, VirtualConsole } = require("jsdom");

const manifest = JSON.parse(readFileSync(`${__dirname}/../manifest.json`, "utf8"));
const runViewAssets = manifest.content_scripts.find(
  (entry) => entry.js?.includes("run-view.js")
);
const scripts = runViewAssets.js.map((path) =>
  readFileSync(`${__dirname}/../${path}`, "utf8")
);
const styles = runViewAssets.css.map((path) =>
  readFileSync(`${__dirname}/../${path}`, "utf8")
);
const graphHTML = `<action-graph>
  <div data-target="action-graph.canvas" tabindex="0">
    <div data-target="action-graph.visualGraph" style="opacity:0">
      <div data-target="action-graph.stages">
        <svg data-targets="action-graph.connectorLines"></svg>
        <div class="WorkflowStage"><div class="WorkflowCard">
          <a href="/owner/repo/actions/runs/123/job/456">Build application</a>
          <button type="button">Expand matrix</button>
        </div></div>
      </div>
    </div>
  </div>
</action-graph>`;
const nativeRunMenuHTML = `<ul role="menu" class="ActionListWrap--inset ActionListWrap">
  <li data-targets="action-list.items" role="none" data-view-component="true" class="ActionListItem"><button tabindex="0" data-view-component="true" type="button" role="menuitem" class="ActionListContent">Create status badge</button></li>
  <li role="none" class="ActionListItem"><button type="button" role="menuitem" class="ActionListContent">Delete all logs</button></li>
</ul>`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

function mockStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    local: {
      async get(key) {
        return { [key]: data[key] };
      },
      async set(items) {
        Object.assign(data, items);
      },
    },
  };
}

async function setup(t, path = "/owner/repo/actions/runs/123", define = true, storage, virtualConsole, beforeScripts) {
  const dom = new JSDOM(graphHTML, {
    url: `https://github.com${path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = function () {
    window.scrolledSummary = this;
  };
  const resizeObservers = [];
  window.ResizeObserver = class {
    targets = new Set();
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    disconnect() {
      this.targets.clear();
    }
  };
  const observers = [];
  window.MutationObserver = class extends window.MutationObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  t.after(() => {
    observers.forEach((observer) => observer.disconnect());
    window.close();
  });
  class ActionGraph extends window.HTMLElement {
    draws = 0;
    fits = 0;
    highlights = 0;
    drawLines() {
      this.draws++;
    }
    fitToWindow() {
      this.fits++;
    }
    setHighlightedGroup() {
      this.highlights++;
    }
    setDownstreamHighlightGroups() {
      this.highlights++;
    }
    async updateJob() {
      this.querySelector("a").textContent = "Build succeeded";
      this.drawLines();
    }
    async expandMatrix() {
      this.querySelector(".WorkflowCard").append("Matrix job loaded");
      this.fitToWindow(false);
      this.drawLines();
    }
  }
  if (define) window.customElements.define("action-graph", ActionGraph);
  window.chrome = { storage: storage ?? mockStorage() };
  beforeScripts?.(window);
  window.eval(readFileSync(`${__dirname}/../settings-storage.js`, "utf8"));
  for (const script of scripts) window.eval(script);
  await settle();
  return {
    window,
    ActionGraph,
    resizeObservers,
    graph: window.document.querySelector("action-graph"),
  };
}

test("waits for page readiness and idle before adapting the run graph", async (t) => {
  const idleCallbacks = [];
  const { window, graph, ActionGraph } = await setup(t, undefined, true, undefined, undefined,
    (page) => { page.requestIdleCallback = (callback) => { idleCallbacks.push(callback); }; });
  assert.equal(window.document.readyState, "complete");
  assert.equal(graph.classList.contains("gha-run-list"), false);
  assert.equal(graph.querySelector(".gha-run-controls"), null);
  graph.drawLines();
  assert.equal(graph.draws, 1);
  assert.equal(idleCallbacks.length, 1);
  idleCallbacks[0]();
  assert.ok(graph.classList.contains("gha-run-list"));
  assert.ok(graph.querySelector(".gha-run-controls"));
  assert.notEqual(graph.drawLines, ActionGraph.prototype.drawLines);
  graph.drawLines();
  assert.equal(graph.draws, 1);
});

test("manifest loads a split run view without leaving its module registry on the page", async (t) => {
  assert.ok(runViewAssets.js.length >= 4);
  assert.ok(runViewAssets.css.length >= 2);
  assert.equal(runViewAssets.js.at(-1), "run-view.js");
  const { window, graph } = await setup(t);
  assert.ok(graph.classList.contains("gha-run-list"));
  assert.ok(graph.querySelector(".gha-run-controls"));
  assert.equal(Object.hasOwn(window, "__ghaRunViewModules"), false);
});

test("stored default view leaves GitHub's job graph untouched", async (t) => {
  const storage = mockStorage({
    ghaRunViewPreferencesV1: { enhancedViewEnabled: false },
  });
  const { graph, ActionGraph } = await setup(t, "/owner/repo/actions/runs/123", true, storage);
  assert.equal(graph.classList.contains("gha-run-list"), false);
  assert.equal(graph.querySelector(".gha-run-controls"), null);
  assert.equal(graph.drawLines, ActionGraph.prototype.drawLines);
});

test("native run menu switches to GitHub's default view and saves the choice", async (t) => {
  const storage = mockStorage();
  const virtualConsole = new VirtualConsole();
  let reloads = 0;
  virtualConsole.on("jsdomError", (error) => {
    if (!error.message.includes("Not implemented: navigation")) throw error;
    reloads++;
  });
  const { window } = await setup(t, "/owner/repo/actions/runs/123", true, storage, virtualConsole);
  window.document.body.insertAdjacentHTML("beforeend", nativeRunMenuHTML);
  await settle();
  const style = window.document.createElement("style");
  style.textContent = styles.join("\n");
  window.document.head.append(style);
  const items = Array.from(window.document.querySelectorAll('ul[role="menu"] button[role="menuitem"]'));
  const toggle = items.find((item) => item.textContent.trim() === "Enhanced view");
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.ok(toggle.querySelector(".gha-run-view-switch-track"));
  assert.equal(window.getComputedStyle(toggle).display, "flex");
  assert.equal(window.getComputedStyle(toggle.querySelector(".gha-run-view-switch-track")).marginLeft, "auto");
  assert.equal(window.getComputedStyle(toggle).whiteSpace, "nowrap");
  assert.equal(items.length, 3);
  assert.equal(toggle.parentElement.getAttribute("data-targets"), "action-list.items");
  assert.equal(toggle.getAttribute("tabindex"), "0");
  toggle.click();
  await settle();
  assert.equal(storage.data.ghaRunViewPreferencesV1.enhancedViewEnabled, false);
  assert.equal(reloads, 1);
});

test("native menu switch stays stable after insertion", async (t) => {
  const { window } = await setup(t);
  window.document.body.insertAdjacentHTML("beforeend", nativeRunMenuHTML);
  await settle();
  const menu = window.document.querySelector('ul[role="menu"]');
  let mutations = 0;
  const observer = new window.MutationObserver((records) => { mutations += records.length; });
  observer.observe(menu, { childList: true, subtree: true });
  await settle();
  observer.disconnect();
  assert.equal(mutations, 0);
});

test("new native menus receive the switch while an older menu remains connected", async (t) => {
  const { window } = await setup(t);
  window.document.body.insertAdjacentHTML("beforeend", nativeRunMenuHTML);
  await settle();
  window.document.body.insertAdjacentHTML("beforeend", nativeRunMenuHTML);
  await settle();
  const menus = Array.from(window.document.querySelectorAll('ul[role="menu"]'));
  assert.equal(menus.length, 2);
  for (const menu of menus)
    assert.equal(menu.querySelectorAll("[data-gha-run-view-switch]").length, 1);
});

test("native menu switch ignores unrelated run-page mutations once mounted", async (t) => {
  const { window } = await setup(t);
  window.document.body.insertAdjacentHTML("beforeend", nativeRunMenuHTML);
  await settle();
  const originalQuery = window.document.querySelectorAll.bind(window.document);
  let menuScans = 0;
  window.document.querySelectorAll = (selector) => {
    if (selector === 'ul[role="menu"] [role="menuitem"]') menuScans++;
    return originalQuery(selector);
  };
  window.document.body.append(window.document.createElement("div"));
  await settle();
  assert.equal(menuScans, 0);
});

test("native menu discovery skips unrelated mutations before the menu opens", async (t) => {
  const { window } = await setup(t);
  const originalQuery = window.document.querySelectorAll.bind(window.document);
  let menuScans = 0;
  window.document.querySelectorAll = (selector) => {
    if (selector === 'ul[role="menu"] [role="menuitem"]') menuScans++;
    return originalQuery(selector);
  };
  window.document.body.append(window.document.createElement("div"));
  await settle();
  assert.equal(menuScans, 0);
});

test("replacement native menu can re-enable the enhanced view", async (t) => {
  const storage = mockStorage({
    ghaRunViewPreferencesV1: { enhancedViewEnabled: false },
  });
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    if (!error.message.includes("Not implemented: navigation")) throw error;
  });
  const first = await setup(t, "/owner/repo/actions/runs/123", true, storage, virtualConsole);
  first.window.document.body.insertAdjacentHTML("beforeend", nativeRunMenuHTML);
  await settle();
  first.window.document.querySelector('ul[role="menu"]').outerHTML = nativeRunMenuHTML;
  await settle();
  const items = Array.from(first.window.document.querySelectorAll('ul[role="menu"] button[role="menuitem"]'));
  assert.equal(items.length, 3);
  const toggle = items.find((item) => item.textContent.trim() === "Enhanced view");
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  toggle.click();
  await settle();
  assert.equal(storage.data.ghaRunViewPreferencesV1.enhancedViewEnabled, true);
  const second = await setup(t, "/owner/repo/actions/runs/123", true, storage);
  assert.equal(second.graph.classList.contains("gha-run-list"), true);
});

test("uses the original job nodes while suppressing graph layout and highlighting", async (t) => {
  const { graph, ActionGraph } = await setup(t);
  assert.ok(graph.classList.contains("gha-run-list"));
  const link = graph.querySelector("a");
  assert.equal(
    link.getAttribute("href"),
    "/owner/repo/actions/runs/123/job/456"
  );
  assert.equal(graph.updateJob, ActionGraph.prototype.updateJob);
  assert.equal(graph.expandMatrix, ActionGraph.prototype.expandMatrix);
  await graph.updateJob();
  await graph.expandMatrix();
  graph.setHighlightedGroup("job");
  graph.setDownstreamHighlightGroups("job");
  assert.equal(graph.querySelector("a"), link);
  assert.equal(link.textContent, "Build succeeded");
  assert.match(graph.textContent, /Matrix job loaded/);
  assert.equal(graph.draws, 0);
  assert.equal(graph.fits, 0);
  assert.equal(graph.highlights, 0);
  assert.equal(
    graph.querySelector('[tabindex="0"]').getAttribute("aria-label"),
    "Workflow jobs, scroll horizontally"
  );
});

test("hover previews the full dependency chain, including matrices", async (t) => {
  const { window, graph } = await setup(t);
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.innerHTML = `<svg class="WorkflowConnectors" data-targets="action-graph.connectorLines">
    <path data-from="group-a" data-to="group-b"></path>
    <path data-from="group-b" data-to="group-c"></path>
  </svg>
  <svg class="WorkflowConnectors" data-target="action-graph.connectorLineHighlights" data-targets="action-graph.connectorLines">
    <path class="WorkflowConnector--hl" data-from="group-b" data-to="group-d"></path>
  </svg>
  <div class="WorkflowStage"><div class="WorkflowCard" id="group-a">A</div></div>
  <div class="WorkflowStage"><div class="WorkflowCard WorkflowCard-group" id="group-b">Matrix B</div></div>
  <div class="WorkflowStage"><div class="WorkflowCard" id="group-c">C</div></div>
  <div class="WorkflowStage"><div class="WorkflowCard" id="group-d">D</div></div>`;
  await settle();
  const card = (id) => window.document.getElementById(`group-${id}`);
  const enter = (id) =>
    card(id).dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  enter("b");
  assert.equal(stages.classList.contains("gha-run-hovering"), true);
  assert.equal(card("b").classList.contains("gha-run-card-hovered"), true);
  assert.equal(card("a").classList.contains("gha-run-card-connected"), true);
  assert.equal(card("c").classList.contains("gha-run-card-connected"), true);
  assert.equal(card("d").classList.contains("gha-run-card-connected"), false);
  enter("a");
  assert.equal(card("a").classList.contains("gha-run-card-hovered"), true);
  assert.equal(card("b").classList.contains("gha-run-card-connected"), true);
  assert.equal(card("c").classList.contains("gha-run-card-connected"), true);
  const replacement = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  replacement.classList.add("WorkflowConnectors");
  replacement.setAttribute("data-targets", "action-graph.connectorLines");
  replacement.innerHTML = '<path data-from="group-a" data-to="group-d"></path>';
  stages.querySelector("svg.WorkflowConnectors").replaceWith(replacement);
  await settle();
  assert.equal(card("b").classList.contains("gha-run-card-connected"), false);
  assert.equal(card("d").classList.contains("gha-run-card-connected"), true);
  replacement.innerHTML = '<path data-from="group-a" data-to="group-c"></path>';
  await settle();
  assert.equal(card("d").classList.contains("gha-run-card-connected"), false);
  assert.equal(card("c").classList.contains("gha-run-card-connected"), true);
  card("a").dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
  assert.equal(stages.classList.contains("gha-run-hovering"), false);
  assert.equal(card("a").classList.contains("gha-run-card-hovered"), false);
  assert.equal(card("c").classList.contains("gha-run-card-connected"), false);
  assert.equal(stages.querySelectorAll(".WorkflowConnectors").length, 2);
});

test("settings menu toggles hover highlighting without disabling scoped view", async (t) => {
  const { window, graph } = await setup(t);
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.innerHTML = `<svg data-targets="action-graph.connectorLines">
    <path data-from="a" data-to="b"></path>
  </svg>
  <div class="WorkflowStage"><div class="WorkflowCard" id="a">A</div></div>
  <div class="WorkflowStage"><div class="WorkflowCard" id="b">B</div></div>
  <div class="WorkflowStage"><div class="WorkflowCard" id="c">C</div></div>`;
  await settle();
  const settings = graph.querySelector(".gha-run-settings");
  const settingsTrigger = settings.querySelector("summary");
  const toggle = graph.querySelector(".gha-run-hover-toggle");
  const label = window.document.getElementById(toggle.getAttribute("aria-labelledby"));
  const card = (id) => graph.querySelector(`#${id}`);
  assert.equal(settingsTrigger.getAttribute("aria-label"), "Job view settings");
  assert.equal(settings.open, false);
  settingsTrigger.click();
  assert.equal(settings.open, true);
  assert.equal(label.textContent, "Highlight related jobs on hover");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.textContent, "On");
  assert.equal(settings.parentElement.className, "gha-run-controls");
  card("a").dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  assert.equal(stages.classList.contains("gha-run-hovering"), true);
  assert.equal(card("b").classList.contains("gha-run-card-connected"), true);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.textContent, "Off");
  assert.equal(settings.open, true);
  assert.equal(stages.classList.contains("gha-run-hovering"), false);
  assert.equal(card("b").classList.contains("gha-run-card-connected"), false);
  card("b").dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  assert.equal(stages.classList.contains("gha-run-hovering"), false);
  card("a").querySelector(".gha-run-scope-button").click();
  await settle();
  assert.equal(card("c").hasAttribute("data-gha-scope-hidden"), true);
  assert.equal(card("a").classList.contains("gha-run-card-scoped"), true);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  card("a").dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  assert.equal(stages.classList.contains("gha-run-hovering"), true);
  assert.equal(card("b").classList.contains("gha-run-card-connected"), true);
  settings.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(settings.open, false);
  assert.equal(window.document.activeElement, settingsTrigger);
  settingsTrigger.click();
  window.document.body.click();
  assert.equal(settings.open, false);
});

test("scoped view keeps the full ancestor and descendant chain and restores other jobs", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("placeholder", "completed"));
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.innerHTML = `<svg data-targets="action-graph.connectorLines">
    <path data-from="p" data-to="a"></path>
    <path data-from="a" data-to="b"></path>
    <path data-from="a" data-to="c"></path>
    <path data-from="b" data-to="d"></path>
    <path data-from="d" data-to="f"></path>
    <path data-from="c" data-to="e"></path>
  </svg>
  <div class="WorkflowStage">${statusCard("p", "completed")}</div>
  <div class="WorkflowStage">${statusCard("a", "completed")}</div>
  <div class="WorkflowStage"><div class="WorkflowCard WorkflowCard-group" id="b"><div class="WorkflowCard-heading">Matrix: B</div>${statusJob("b", "completed")}</div></div>
  <div class="WorkflowStage">${statusCard("c", "failed")}</div>
  <div class="WorkflowStage">${statusCard("d", "failed")}</div>
  <div class="WorkflowStage">${statusCard("f", "completed")}</div>
  <div class="WorkflowStage">${statusCard("e", "completed")}</div>`;
  await settle();
  const card = (id) => graph.querySelector(`#${id}`);
  const reset = graph.querySelector(".gha-run-scope-reset");
  const header = graph.querySelector(".gha-run-scrollbar-header");
  const navigation = graph.querySelector(".gha-run-scroll-navigation");
  assert.equal(reset.hidden, true);
  assert.deepEqual(Array.from(navigation.children), [reset, header]);
  assert.equal(graph.querySelectorAll(".gha-run-scope-button").length, 7);
  assert.equal(
    card("b").querySelector(".gha-run-scope-button").parentElement,
    card("b")
  );
  assert.ok(card("b").querySelector(".gha-run-scope-button svg[fill='none']"));
  assert.match(card("b").querySelector(".gha-run-scope-button").getAttribute("aria-label"), /Matrix: B/);
  card("b").dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  for (const id of ["p", "a", "d", "f"])
    assert.equal(card(id).classList.contains("gha-run-card-connected"), true, id);
  for (const id of ["c", "e"])
    assert.equal(card(id).classList.contains("gha-run-card-connected"), false, id);
  card("b").querySelector(".gha-run-scope-button").click();
  await settle();
  assert.equal(reset.hidden, false);
  assert.equal(card("b").classList.contains("gha-run-card-scoped"), true);
  assert.equal(window.getComputedStyle(header).display, "none");
  for (const id of ["p", "a", "b", "d", "f"])
    assert.notEqual(window.getComputedStyle(card(id)).display, "none", id);
  for (const id of ["c", "e"])
    assert.equal(window.getComputedStyle(card(id)).display, "none", id);
  assert.equal(card("c").parentElement.hasAttribute("data-gha-scope-hidden"), true);
  statusCheckbox(graph, "failed").click();
  await settle();
  assert.equal(window.getComputedStyle(card("a")).display, "none");
  assert.notEqual(window.getComputedStyle(card("d")).display, "none");
  reset.click();
  await settle();
  assert.equal(reset.hidden, true);
  assert.equal(card("b").classList.contains("gha-run-card-scoped"), false);
  assert.equal(window.document.activeElement, graph.querySelector('[data-target="action-graph.canvas"]'));
  assert.equal(window.getComputedStyle(header).display, "none");
  assert.notEqual(window.getComputedStyle(card("c")).display, "none");
  assert.equal(window.getComputedStyle(card("e")).display, "none");
});

test("scoped view follows connector changes and survives job card updates", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("placeholder", "completed"));
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.innerHTML = `<svg data-targets="action-graph.connectorLines">
    <path data-from="a" data-to="b"></path>
  </svg>
  <div class="WorkflowStage">${statusCard("a", "completed")}</div>
  <div class="WorkflowStage">${statusCard("b", "completed")}</div>
  <div class="WorkflowStage">${statusCard("c", "completed")}</div>`;
  await settle();
  const card = (id) => graph.querySelector(`#${id}`);
  card("a").querySelector(".gha-run-scope-button").click();
  await settle();
  assert.equal(window.getComputedStyle(card("c")).display, "none");
  stages.querySelector("svg").insertAdjacentHTML("beforeend", '<path data-from="b" data-to="c"></path>');
  await settle();
  assert.notEqual(window.getComputedStyle(card("c")).display, "none");
  card("a").querySelector(".gha-run-scope-button").click();
  await settle();
  assert.equal(graph.querySelector(".gha-run-scope-reset").hidden, true);
  card("a").querySelector(".gha-run-scope-button").click();
  await settle();
  card("b").replaceWith(window.document.createRange().createContextualFragment(statusCard("b", "completed")));
  await settle();
  assert.equal(graph.querySelectorAll("#b .gha-run-scope-button").length, 1);
  assert.equal(graph.querySelector(".gha-run-scope-reset").hidden, false);
  card("b").querySelector(".WorkflowJob-title span").textContent = "Renamed B";
  await settle();
  assert.match(card("b").querySelector(".gha-run-scope-button").getAttribute("aria-label"), /Renamed B/);
  card("a").parentElement.remove();
  await settle();
  assert.equal(graph.querySelector(".gha-run-scope-reset").hidden, true);
});

test("lets the browser scroll and select text without native graph interception", async (t) => {
  const { window, graph } = await setup(t);
  for (const type of ["wheel", "pointerdown", "pointermove", "selectstart"]) {
    let nativeCalls = 0;
    graph.addEventListener(type, (event) => {
      nativeCalls++;
      event.preventDefault();
    });
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    graph.querySelector("a").dispatchEvent(event);
    assert.equal(nativeCalls, 0, type);
    assert.equal(event.defaultPrevented, false, type);
  }
  graph.addEventListener("keydown", (event) => event.preventDefault());
  const arrow = new window.KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  graph.querySelector('[tabindex="0"]').dispatchEvent(arrow);
  assert.equal(arrow.defaultPrevented, false);
  let clicked = false;
  graph.querySelector(".WorkflowCard button").addEventListener("click", () => {
    clicked = true;
  });
  graph.querySelector(".WorkflowCard button").click();
  assert.equal(clicked, true);
});

test("handles late custom element registration and graph partial replacements", async (t) => {
  const { window, ActionGraph, graph } = await setup(t, undefined, false);
  assert.equal(graph.classList.contains("gha-run-list"), false);
  window.customElements.define("action-graph", ActionGraph);
  await settle();
  assert.ok(graph.classList.contains("gha-run-list"));
  const replacement = window.document.createElement("div");
  replacement.innerHTML = graphHTML;
  graph.replaceWith(replacement);
  await settle();
  assert.ok(replacement.querySelector(".gha-run-list"));
});

test("initializes after Code to run navigation and leaves job details alone", async (t) => {
  const { window, graph } = await setup(t, "/owner/repo");
  assert.equal(graph.classList.contains("gha-run-list"), false);
  window.history.pushState({}, "", "/owner/repo/actions/runs/123");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle();
  assert.ok(graph.classList.contains("gha-run-list"));
  const details = await setup(t, "/owner/repo/actions/runs/123/job/456");
  assert.equal(details.graph.classList.contains("gha-run-list"), false);
});

test("ignores log mutations on job pages while still handling run navigation", async (t) => {
  const { window, graph } = await setup(t, "/owner/repo/actions/runs/123/job/456");
  const originalFrame = window.requestAnimationFrame.bind(window);
  let frames = 0;
  window.requestAnimationFrame = (callback) => {
    frames++;
    return originalFrame(callback);
  };

  const logs = window.document.createElement("div");
  logs.className = "js-checks-log-display-container";
  window.document.body.append(logs);
  for (let i = 0; i < 100; i++) {
    logs.append(window.document.createElement("div"));
  }
  await settle();
  assert.equal(frames, 0);

  window.history.pushState({}, "", "/owner/repo/actions/runs/123");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle();
  assert.ok(graph.classList.contains("gha-run-list"));
});

test("keeps the native view when required GitHub hooks or targets are unavailable", async (t) => {
  const { window, ActionGraph, graph } = await setup(t, undefined, false);
  ActionGraph.prototype.drawLines = undefined;
  window.customElements.define("action-graph", ActionGraph);
  await settle();
  assert.equal(graph.classList.contains("gha-run-list"), false);
  assert.equal(graph.fitToWindow, ActionGraph.prototype.fitToWindow);
});

test("keeps the native view when its visual graph target is missing", async (t) => {
  const { window, ActionGraph, graph } = await setup(t, undefined, false);
  graph
    .querySelector('[data-target="action-graph.visualGraph"]')
    .removeAttribute("data-target");
  window.customElements.define("action-graph", ActionGraph);
  await settle();
  assert.equal(graph.classList.contains("gha-run-list"), false);
  assert.equal(graph.drawLines, ActionGraph.prototype.drawLines);
});

function setDimensions(canvas, width, viewport) {
  Object.defineProperties(canvas, {
    scrollWidth: { configurable: true, value: width },
    clientWidth: { configurable: true, value: viewport },
  });
}

test("floating scrollbar syncs native and input scrolling outside the canvas", async (t) => {
  const { window, graph, resizeObservers } = await setup(t);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const input = graph.querySelector('input[type="range"]');
  assert.ok(input, "a native range is available");
  const header = graph.querySelector(".gha-run-scrollbar-header");
  const navigation = graph.querySelector(".gha-run-scroll-navigation");
  assert.equal(input.parentElement, header);
  assert.deepEqual(
    Array.from(header.children, (child) => child.dataset.direction || child.type),
    ["-1", "1", "range"]
  );
  const frame = graph.querySelector(".gha-run-canvas-frame");
  assert.equal(header.parentElement, navigation);
  assert.equal(navigation.parentElement.nextElementSibling, frame);
  assert.equal(frame?.firstElementChild, canvas);
  assert.equal(frame?.lastElementChild, graph.querySelector(".gha-run-resize-handle"));
  assert.equal(canvas.contains(input), false);
  assert.ok(input.getAttribute("aria-label"));
  setDimensions(canvas, 1400, 600);
  resizeObservers[0].callback();
  assert.equal(input.max, "800");
  assert.equal(input.disabled, false);
  for (const type of ["pointerdown", "pointermove", "wheel", "keydown"]) {
    let nativeCalls = 0;
    const intercept = (event) => {
      nativeCalls++;
      event.preventDefault();
    };
    graph.addEventListener(type, intercept);
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    assert.equal(nativeCalls, 0, type);
    assert.equal(event.defaultPrevented, false, type);
    graph.removeEventListener(type, intercept);
  }
  input.value = "250";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(canvas.scrollLeft, 250);
  canvas.scrollLeft = 500;
  canvas.dispatchEvent(new window.Event("scroll"));
  assert.equal(input.value, "500");
});

test("resizes the jobs view vertically by drag and keyboard", async (t) => {
  const storage = mockStorage();
  const { window, graph } = await setup(t, "/owner/repo/actions/runs/123", true, storage);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const handle = graph.querySelector(".gha-run-resize-handle");
  assert.equal(canvas.nextElementSibling, handle);
  assert.equal(handle.getAttribute("aria-label"), "Resize jobs view vertically");
  canvas.getBoundingClientRect = () => ({ height: 600 });
  handle.setPointerCapture = () => {};
  const pointer = (type, clientY) => {
    const event = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientY,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    handle.dispatchEvent(event);
  };
  pointer("pointerdown", 100);
  pointer("pointermove", 180);
  assert.equal(canvas.style.getPropertyValue("--gha-run-canvas-height"), "680px");
  assert.equal(storage.data.ghaRunViewPreferencesV1, undefined);
  pointer("pointermove", -1000);
  assert.equal(canvas.style.getPropertyValue("--gha-run-canvas-height"), "180px");
  pointer("pointerup", -1000);
  await settle();
  assert.equal(storage.data.ghaRunViewPreferencesV1.jobsViewHeight, 180);
  pointer("pointermove", 300);
  assert.equal(canvas.style.getPropertyValue("--gha-run-canvas-height"), "180px");
  handle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(canvas.style.getPropertyValue("--gha-run-canvas-height"), "220px");
  await settle();
  assert.equal(storage.data.ghaRunViewPreferencesV1.jobsViewHeight, 220);
});

test("restores local view preferences after a page refresh without restoring filters", async (t) => {
  const storage = mockStorage();
  const first = await setup(t, "/owner/repo/actions/runs/123", true, storage);
  assert.equal(first.graph.querySelector(".gha-run-controls").dataset.searchPosition, "right");
  const canvas = first.graph.querySelector('[data-target="action-graph.canvas"]');
  canvas.getBoundingClientRect = () => ({ height: 600 });
  first.graph.querySelector(".gha-run-resize-handle").dispatchEvent(
    new first.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
  );
  first.graph.querySelector(".gha-run-hover-toggle").click();
  assert.equal(first.graph.querySelector(".gha-run-group-toggle").getAttribute("aria-pressed"), "false");
  first.graph.querySelector(".gha-run-group-toggle").click();
  first.graph
    .querySelector('.gha-run-setting-choices button[data-value="left"]')
    .click();
  first.graph
    .querySelector('.gha-run-setting-choices button[data-value="both"]')
    .click();
  first.graph.querySelector('.gha-run-hide-filter input[value="completed"]').click();
  await settle();

  const second = await setup(t, "/owner/repo/actions/runs/123", true, storage);
  assert.equal(
    second.graph.querySelector('[data-target="action-graph.canvas"]').style.getPropertyValue("--gha-run-canvas-height"),
    "640px"
  );
  assert.equal(second.graph.querySelector(".gha-run-hover-toggle").getAttribute("aria-pressed"), "false");
  assert.equal(second.graph.querySelector(".gha-run-group-toggle").getAttribute("aria-pressed"), "true");
  assert.equal(storage.data.ghaRunViewPreferencesV1.searchPosition, "left");
  assert.equal(storage.data.ghaRunViewPreferencesV1.arrowPlacement, "both");
  assert.equal(
    second.graph.querySelector(".gha-run-controls").dataset.searchPosition,
    "left"
  );
  assert.equal(
    second.graph.querySelector(".gha-run-job-search-wrap").parentElement,
    second.graph.querySelector(".gha-run-hide-filter").parentElement
  );
  assert.deepEqual(
    Array.from(second.graph.querySelector(".gha-run-controls").children, (child) => child.className),
    ["gha-run-settings", "gha-run-job-tools"]
  );
  const header = second.graph.querySelector(".gha-run-scrollbar-header");
  assert.deepEqual(
    Array.from(header.children),
    [
      header.querySelector('[data-direction="-1"]'),
      header.querySelector('input[type="range"]'),
      header.querySelector('[data-direction="1"]'),
    ]
  );
  assert.equal(second.graph.querySelector('.gha-run-hide-filter input[value="completed"]').checked, false);
});

test("layout choices move search and filters together and reposition scrollbar arrows", async (t) => {
  const { window, graph } = await setup(t);
  const style = window.document.createElement("style");
  style.textContent = styles.join("\n");
  window.document.head.append(style);
  const controls = graph.querySelector(".gha-run-controls");
  const jobTools = controls.querySelector(".gha-run-job-tools");
  const settings = controls.querySelector(".gha-run-settings");
  const settingsMenu = settings.querySelector(".gha-run-settings-menu");
  const search = jobTools.querySelector(".gha-run-job-search");
  const filter = jobTools.querySelector(".gha-run-hide-filter");
  const searchFilter = jobTools.querySelector(".gha-run-search-filter");
  const popup = filter.querySelector(".gha-run-hide-options");
  const header = graph.querySelector(".gha-run-scrollbar-header");
  const navigation = graph.querySelector(".gha-run-scroll-navigation");
  const bar = graph.querySelector(".gha-run-scrollbar");
  const left = header.querySelector('[data-direction="-1"]');
  const right = header.querySelector('[data-direction="1"]');
  const range = header.querySelector('input[type="range"]');
  const searchChoices = graph.querySelectorAll(".gha-run-setting-choices")[0];
  const arrowChoices = graph.querySelectorAll(".gha-run-setting-choices")[1];
  assert.deepEqual(Array.from(controls.children), [jobTools, settings]);
  assert.equal(jobTools.firstElementChild, searchFilter);
  assert.deepEqual(Array.from(searchFilter.children), [search.parentElement, filter]);
  assert.equal(bar.querySelector(".gha-run-filter-chips"), null);
  assert.equal(bar.querySelector("[role='status']")?.textContent, "");
  assert.equal(controls.dataset.searchPosition, "right");
  assert.equal(bar.dataset.searchPosition, "right");
  assert.equal(window.getComputedStyle(controls).gridRow, "1");
  assert.equal(window.getComputedStyle(navigation).gridRow, "1");
  assert.equal(window.getComputedStyle(controls).gridColumn, "2");
  assert.equal(window.getComputedStyle(navigation).gridColumn, "1");
  assert.equal(window.getComputedStyle(jobTools).marginInlineStart, "auto");
  assert.equal(window.getComputedStyle(filter).position, "relative");
  assert.deepEqual(Array.from(header.children), [left, right, range]);
  searchChoices.querySelector('[data-value="left"]').click();
  assert.equal(controls.dataset.searchPosition, "left");
  assert.equal(bar.dataset.searchPosition, "left");
  assert.deepEqual(Array.from(controls.children), [settings, jobTools]);
  assert.deepEqual(Array.from(searchFilter.children), [filter, search.parentElement]);
  assert.equal(window.getComputedStyle(controls).gridColumn, "1");
  assert.equal(window.getComputedStyle(navigation).gridColumn, "2");
  assert.equal(window.getComputedStyle(jobTools).marginInlineStart, "auto");
  assert.equal(window.getComputedStyle(settingsMenu).left, "0px");
  assert.equal(window.getComputedStyle(settingsMenu).right, "auto");
  searchChoices.querySelector('[data-value="right"]').click();
  assert.equal(controls.dataset.searchPosition, "right");
  assert.deepEqual(Array.from(controls.children), [jobTools, settings]);
  assert.equal(window.getComputedStyle(settings).marginInlineStart, "");
  assert.equal(window.getComputedStyle(settingsMenu).right, "0px");
  assert.equal(window.getComputedStyle(popup).right, "0px");
  assert.deepEqual(Array.from(searchFilter.children), [search.parentElement, filter]);
  assert.equal(searchChoices.querySelector('[data-value="right"]').getAttribute("aria-pressed"), "true");
  arrowChoices.querySelector('[data-value="right"]').click();
  assert.deepEqual(Array.from(header.children), [range, left, right]);
  arrowChoices.querySelector('[data-value="both"]').click();
  assert.deepEqual(Array.from(header.children), [left, range, right]);
  assert.equal(arrowChoices.querySelector('[data-value="both"]').getAttribute("aria-pressed"), "true");
  arrowChoices.querySelector('[data-value="left"]').click();
  assert.deepEqual(Array.from(header.children), [left, right, range]);
});

test("dragging either end of a wide scrollbar handle moves immediately", async (t) => {
  const { window, graph, resizeObservers } = await setup(t);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const input = graph.querySelector('input[type="range"]');
  Object.defineProperty(input, "clientWidth", { value: 900 });
  input.getBoundingClientRect = () => ({ left: 50, width: 900 });
  input.setPointerCapture = () => {};
  setDimensions(canvas, 700, 600);
  resizeObservers[0].callback();
  assert.equal(input.style.getPropertyValue("--gha-run-scroll-thumb-width"), "720px");

  const pointer = (type, clientX) => {
    const event = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    input.dispatchEvent(event);
    return event;
  };
  for (const grabX of [60, 750]) {
    canvas.scrollLeft = 0;
    canvas.dispatchEvent(new window.Event("scroll"));
    assert.equal(pointer("pointerdown", grabX).defaultPrevented, true);
    pointer("pointermove", grabX + 10);
    assert.equal(canvas.scrollLeft, 6);
    pointer("pointerup", grabX + 10);
    pointer("pointermove", grabX + 20);
    assert.equal(canvas.scrollLeft, 6);
  }
  canvas.scrollLeft = 100;
  canvas.dispatchEvent(new window.Event("scroll"));
  pointer("pointerdown", 240);
  pointer("pointermove", 230);
  assert.equal(canvas.scrollLeft, 94);
  pointer("pointerup", 230);

  canvas.scrollLeft = 0;
  canvas.dispatchEvent(new window.Event("scroll"));
  assert.equal(pointer("pointerdown", 940).defaultPrevented, false);
});

test("shows vertical overflow without a native horizontal bar", async (t) => {
  const { window, graph, resizeObservers } = await statusSetup(
    t,
    statusCard("ok", "completed")
  );
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const style = window.getComputedStyle(canvas);
  assert.equal(style.overflowX, "hidden");
  assert.equal(style.overflowY, "auto");

  setDimensions(canvas, 1400, 600);
  resizeObservers.at(-1).callback();
  assert.equal(graph.querySelector('input[type="range"]').max, "800");
  const wheel = new window.WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX: 100,
    deltaY: 80,
  });
  assert.equal(wheel.deltaX, 100);
  canvas.dispatchEvent(wheel);
  assert.equal(canvas.scrollLeft, 100);
  assert.equal(wheel.defaultPrevented, false);
  canvas.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
  );
  assert.equal(canvas.scrollLeft, 140);
});

test("scrollbar chevrons move one visible stage at a time and disable at the edges", async (t) => {
  const { window, graph, resizeObservers } = await setup(t);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  const firstStage = stages.querySelector(".WorkflowStage");
  for (let index = 1; index < 4; index++) {
    const stage = firstStage.cloneNode(true);
    Object.defineProperty(stage, "offsetLeft", { value: index * 316 });
    stages.append(stage);
  }
  const range = graph.querySelector('input[type="range"]');
  const left = graph.querySelector(
    'button[aria-label="Scroll workflow jobs left"]'
  );
  const right = graph.querySelector(
    'button[aria-label="Scroll workflow jobs right"]'
  );
  assert.ok(left && right);
  assert.equal(left.disabled, true);
  assert.equal(right.disabled, true);
  setDimensions(canvas, 1400, 600);
  resizeObservers[0].callback();
  assert.equal(left.disabled, true);
  assert.equal(right.disabled, false);
  right.click();
  assert.equal(canvas.scrollLeft, 316);
  assert.equal(range.value, "316");
  assert.equal(left.disabled, false);
  right.click();
  assert.equal(canvas.scrollLeft, 632);
  right.click();
  assert.equal(canvas.scrollLeft, 800);
  assert.equal(right.disabled, true);
  left.click();
  assert.equal(canvas.scrollLeft, 632);
  left.click();
  assert.equal(canvas.scrollLeft, 316);
  left.click();
  assert.equal(canvas.scrollLeft, 0);
  assert.equal(left.disabled, true);
  canvas.scrollLeft = 200;
  canvas.dispatchEvent(new window.Event("scroll"));
  assert.equal(left.disabled, false);
  right.click();
  assert.equal(canvas.scrollLeft, 316);
  left.click();
  assert.equal(canvas.scrollLeft, 0);
  stages
    .querySelectorAll(".WorkflowStage")[1]
    .setAttribute("data-gha-status-hidden", "");
  right.click();
  assert.equal(canvas.scrollLeft, 632);
  range.value = "800";
  range.dispatchEvent(new window.Event("input"));
  assert.equal(right.disabled, true);
  setDimensions(canvas, 600, 600);
  resizeObservers[0].callback();
  assert.equal(left.disabled, true);
  assert.equal(right.disabled, true);
});

test("updates overflow on resize and matrix mutations, reusing the control", async (t) => {
  const { graph, resizeObservers } = await setup(t);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const input = graph.querySelector('input[type="range"]');
  assert.ok(input);
  assert.equal(input.disabled, true);
  assert.equal(input.max, "0");
  setDimensions(canvas, 1600, 600);
  await graph.expandMatrix();
  await settle();
  assert.equal(input.max, "1000");
  assert.equal(input.disabled, false);
  canvas.scrollLeft = 900;
  setDimensions(canvas, 700, 600);
  resizeObservers[0].callback();
  assert.equal(input.max, "100");
  assert.equal(canvas.scrollLeft, 100);
  assert.equal(input.value, "100");
  setDimensions(canvas, 600, 600);
  resizeObservers[0].callback();
  assert.equal(input.disabled, true);
  assert.equal(input.value, "0");
  assert.equal(canvas.scrollLeft, 0);
  assert.equal(graph.querySelector('input[type="range"]'), input);
  assert.equal(graph.querySelectorAll('input[type="range"]').length, 1);
});

test("hides the scrollbar row when jobs fit and restores it on overflow", async (t) => {
  const { window, graph, resizeObservers } = await statusSetup(
    t,
    statusCard("ok", "completed")
  );
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const header = graph.querySelector(".gha-run-scrollbar-header");
  const controls = graph.querySelector(".gha-run-controls");
  assert.equal(window.getComputedStyle(header).display, "none");
  assert.equal(window.getComputedStyle(canvas).borderTopLeftRadius, "6px");
  assert.equal(window.getComputedStyle(canvas).borderTopRightRadius, "6px");
  assert.notEqual(window.getComputedStyle(controls).display, "none");

  setDimensions(canvas, 1200, 600);
  resizeObservers.at(-1).callback();
  assert.equal(window.getComputedStyle(header).display, "flex");
  assert.equal(window.getComputedStyle(canvas).borderTopLeftRadius, "6px");

  setDimensions(canvas, 600, 600);
  resizeObservers.at(-1).callback();
  assert.equal(window.getComputedStyle(header).display, "none");
  assert.equal(window.getComputedStyle(canvas).borderTopLeftRadius, "6px");
  assert.notEqual(window.getComputedStyle(controls).display, "none");
});

test("hides a non-scrollable scoped scrollbar while keeping the exit button", async (t) => {
  const { window, graph, resizeObservers } = await statusSetup(
    t,
    statusCard("scoped", "completed")
  );
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const input = graph.querySelector('.gha-run-scrollbar input[type="range"]');
  const header = graph.querySelector(".gha-run-scrollbar-header");
  const reset = graph.querySelector(".gha-run-scope-reset");
  graph.querySelector(".gha-run-scope-button").click();
  await settle();

  assert.equal(reset.hidden, false);
  assert.equal(input.disabled, true);
  assert.equal(window.getComputedStyle(header).display, "none");
  setDimensions(canvas, 1200, 600);
  resizeObservers.at(-1).callback();
  assert.equal(window.getComputedStyle(header).display, "flex");
  setDimensions(canvas, 600, 600);
  resizeObservers.at(-1).callback();
  assert.equal(window.getComputedStyle(header).display, "none");
  assert.equal(reset.hidden, false);
});

test("ignores trailing graph space after filtering when visible stages fit", async (t) => {
  const { window, graph, resizeObservers } = await statusSetup(
    t,
    statusCard("first", "completed")
  );
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  for (let index = 1; index < 6; index++)
    stages.insertAdjacentHTML(
      "beforeend",
      `<div class="WorkflowStage">${statusCard(`job-${index}`, "completed")}</div>`
    );
  stages.insertAdjacentHTML(
    "beforeend",
    `<div class="WorkflowStage">${statusCard("hidden", "failed")}</div>`
  );
  await settle();
  statusCheckbox(graph, "completed").click();
  await settle();
  const visible = stages.querySelectorAll(
    ":scope > .WorkflowStage:not([data-gha-status-hidden])"
  );
  assert.equal(visible.length, 6);
  for (let index = 0; index < visible.length; index++) {
    Object.defineProperties(visible[index], {
      offsetLeft: { value: index * 316 },
      offsetWidth: { value: 300 },
    });
  }
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const input = graph.querySelector('.gha-run-scrollbar input[type="range"]');
  const header = graph.querySelector(".gha-run-scrollbar-header");
  setDimensions(canvas, 1917, 1880);
  resizeObservers.at(-1).callback();
  assert.equal(input.max, "0");
  assert.equal(input.disabled, true);
  assert.equal(window.getComputedStyle(header).display, "none");

  setDimensions(canvas, 1917, 1600);
  resizeObservers.at(-1).callback();
  assert.equal(input.max, "280");
  assert.equal(input.disabled, false);
  assert.equal(window.getComputedStyle(header).display, "flex");

  graph.querySelector("#first .gha-run-scope-button").click();
  await settle();
  assert.equal(graph.querySelector(".gha-run-scope-reset").hidden, false);
  assert.equal(input.max, "0");
  assert.equal(window.getComputedStyle(header).display, "none");
});

test("grows the scrollbar handle as horizontal overflow shrinks", async (t) => {
  const { graph, resizeObservers } = await setup(t);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const input = graph.querySelector('input[type="range"]');
  const thumbWidth = () =>
    input.style.getPropertyValue("--gha-run-scroll-thumb-width");
  Object.defineProperty(input, "clientWidth", {
    configurable: true,
    value: 900,
  });

  setDimensions(canvas, 700, 600);
  resizeObservers[0].callback();
  assert.equal(thumbWidth(), "720px");

  setDimensions(canvas, 1200, 600);
  resizeObservers[0].callback();
  assert.equal(thumbWidth(), "360px");

  setDimensions(canvas, 3000, 600);
  resizeObservers[0].callback();
  assert.equal(thumbWidth(), "129px");

  setDimensions(canvas, 6000, 600);
  resizeObservers[0].callback();
  assert.equal(thumbWidth(), "64px");

  setDimensions(canvas, 18000, 600);
  resizeObservers[0].callback();
  assert.equal(thumbWidth(), "64px");

  Object.defineProperty(input, "clientWidth", {
    configurable: true,
    value: 200,
  });
  setDimensions(canvas, 1200, 600);
  assert.ok(resizeObservers[0].targets.has(input));
  resizeObservers[0].callback();
  assert.equal(thumbWidth(), "80px");
});

test("replaces scrollbar bindings and releases observers and listeners", async (t) => {
  const { window, graph, resizeObservers } = await setup(t);
  const oldCanvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const oldInput = graph.querySelector('input[type="range"]');
  const oldResizeHandle = graph.querySelector(".gha-run-resize-handle");
  const oldFilter = graph.querySelector(".gha-run-hide-filter");
  const oldCheckbox = statusCheckbox(graph, "completed");
  const oldRight = graph.querySelector(
    'button[aria-label="Scroll workflow jobs right"]'
  );
  assert.ok(oldRight);
  setDimensions(oldCanvas, 1200, 600);
  resizeObservers[0].callback();
  assert.ok(oldInput);
  oldCanvas.getBoundingClientRect = () => ({ height: 600 });
  oldResizeHandle.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
  );
  const newCanvas = oldCanvas.cloneNode(true);
  newCanvas.style.removeProperty("--gha-run-canvas-height");
  setDimensions(newCanvas, 1500, 500);
  oldCanvas.replaceWith(newCanvas);
  await settle();
  const input = graph.querySelector('input[type="range"]');
  assert.notEqual(input, oldInput);
  assert.equal(input.max, "1000");
  assert.equal(newCanvas.style.getPropertyValue("--gha-run-canvas-height"), "560px");
  assert.equal(graph.querySelectorAll(".gha-run-resize-handle").length, 1);
  assert.equal(graph.querySelectorAll(".gha-run-canvas-frame").length, 1);
  assert.equal(oldResizeHandle.isConnected, false);
  assert.equal(resizeObservers[0].targets.size, 0);
  oldCheckbox.checked = true;
  oldCheckbox.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle();
  assert.equal(statusCheckbox(graph, "completed").checked, false);
  oldFilter.open = true;
  const oldPopup = oldFilter.querySelector(".gha-run-hide-options");
  oldPopup.style.maxHeight = "123px";
  window.dispatchEvent(new window.Event("resize"));
  await settle();
  assert.equal(oldPopup.style.maxHeight, "123px");
  oldInput.value = "10";
  oldRight.click();
  assert.equal(oldCanvas.scrollLeft, 0);
  oldInput.dispatchEvent(new window.Event("input"));
  assert.equal(oldCanvas.scrollLeft, 0);
  graph.remove();
  await settle();
  assert.equal(resizeObservers[1].targets.size, 0);
  input.value = "20";
  input.dispatchEvent(new window.Event("input"));
  assert.equal(newCanvas.scrollLeft, 0);
  assert.equal(graph.querySelector('input[type="range"]'), null);
  assert.equal(graph.querySelector(".gha-run-resize-handle"), null);
});

test("restored navigation snapshots have one working toolbar after repeated returns", async (t) => {
  const { window, graph, resizeObservers } = await statusSetup(
    t,
    statusCard("skip", "skipped") + statusCard("cancel", "cancelled")
  );
  let current = graph;
  for (let visit = 0; visit < 3; visit++) {
    const cached = current.cloneNode(true);
    if (visit === 0) {
      cached.prepend(
        cached.querySelector(".gha-run-scrollbar").cloneNode(true)
      );
    }
    window.history.pushState({}, "", "/owner/repo/actions/runs/123/job/456");
    current.remove();
    window.document.body.append("Job details");
    window.document.dispatchEvent(new window.Event("turbo:load"));
    await settle();
    assert.ok(resizeObservers.every((observer) => observer.targets.size === 0));

    window.history.back();
    window.document.body.replaceChildren(cached);
    window.document.dispatchEvent(new window.Event("turbo:load"));
    await settle();
    current = cached;
    assert.equal(
      window.document.querySelectorAll(".gha-run-scrollbar").length,
      1
    );
    assert.equal(current.querySelectorAll(".gha-run-controls").length, 1);
    assert.equal(current.querySelectorAll(".gha-run-job-search").length, 1);
    assert.equal(current.querySelectorAll('input[type="range"]').length, 1);
    assert.equal(current.querySelectorAll(".gha-run-scroll-arrow").length, 2);
    assert.equal(current.querySelectorAll(".gha-run-resize-handle").length, 1);
    assert.equal(current.querySelectorAll(".gha-run-canvas-frame").length, 1);
    for (const status of ["skipped", "cancelled"]) {
      const button = statusCheckbox(current, status);
      const trigger = current.querySelector(".gha-run-hide-trigger");
      const pressed = button.checked;
      button.click();
      await settle();
      assert.equal(button.checked, !pressed);
      assert.equal(
        trigger.textContent.trim() !== "Filter jobs",
        current.querySelectorAll('.gha-run-hide-filter input:checked').length > 0
      );
      const card = current.querySelector(
        status === "skipped" ? "#skip" : "#cancel"
      );
      const otherStatus = status === "skipped" ? "cancelled" : "skipped";
      assert.equal(
        window.getComputedStyle(card).display === "none",
        !button.checked && statusCheckbox(current, otherStatus).checked
      );
    }
    const canvas = current.querySelector('[data-target="action-graph.canvas"]');
    setDimensions(canvas, 1500, 500);
    resizeObservers.at(-1).callback();
    const range = current.querySelector('input[type="range"]');
    range.value = "250";
    range.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(canvas.scrollLeft, 250);
    canvas.scrollLeft = 500;
    canvas.dispatchEvent(new window.Event("scroll"));
    assert.equal(range.value, "500");
  }
});

const workflowInfoHTML = `<div class="d-flex flex-items-center flex-justify-between p-md-1 pb-md-2">
  <div class="p-2 color-bg-inset"><h2><a href="/owner/repo/actions/runs/123/workflow">projects-continuous-integration.yaml</a></h2>
  <div class="text-small color-fg-muted">on: workflow_dispatch</div></div>
</div>`;
const summaryHTML = `<div class="actions-workflow-stats" aria-label="Workflow run summary">
  <div class="d-flex flex-wrap"><div>Status: Success</div><div>Artifacts: 5</div></div>
</div>`;

test("moves the original workflow filename and trigger to the end of the run summary", async (t) => {
  const { window, graph } = await setup(t);
  window.document.body.insertAdjacentHTML("afterbegin", summaryHTML);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  canvas.insertAdjacentHTML("afterbegin", workflowInfoHTML);
  const info = canvas.firstElementChild;
  const link = info.querySelector("a");
  await settle();
  const summary = window.document.querySelector(
    ".actions-workflow-stats > .d-flex"
  );
  assert.equal(summary.lastElementChild, info);
  assert.equal(info.querySelector("a"), link);
  assert.equal(
    link.getAttribute("href"),
    "/owner/repo/actions/runs/123/workflow"
  );
  assert.match(info.textContent, /on: workflow_dispatch/);
  assert.equal(canvas.contains(info), false);
  assert.equal(summary.firstElementChild.textContent, "Status: Success");
});

test("moves an unlinked dynamic workflow title to the run summary", async (t) => {
  const { window, graph } = await setup(t);
  window.document.body.insertAdjacentHTML("afterbegin", summaryHTML);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  canvas.insertAdjacentHTML(
    "afterbegin",
    `<div class="d-flex flex-items-center flex-justify-between position-relative p-md-1 pb-md-2">
      <div class="p-2 color-bg-inset rounded position-relative">
        <h2 class="h4 d-flex flex-items-center">copilot-pull-request-reviewer</h2>
        <div class="text-small color-fg-muted">on: dynamic</div>
      </div>
    </div>`
  );
  const info = canvas.firstElementChild;
  await settle();
  const summary = window.document.querySelector(
    ".actions-workflow-stats > .d-flex"
  );
  assert.equal(summary.lastElementChild, info);
  assert.equal(canvas.contains(info), false);
  assert.match(info.textContent, /on: dynamic/);
});

test("does not move the job graph when its title block is absent", async (t) => {
  const { window, graph } = await setup(t);
  window.document.body.insertAdjacentHTML("afterbegin", summaryHTML);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  const visualGraph = graph.querySelector(
    '[data-target="action-graph.visualGraph"]'
  );
  visualGraph.insertAdjacentHTML("beforeend", "<h2>Job details</h2>");
  await settle();
  assert.equal(canvas.contains(visualGraph), true);
  assert.equal(
    window.document
      .querySelector(".actions-workflow-stats")
      .contains(visualGraph),
    false
  );
});

test("reattaches workflow info after summary refresh and cleans up after graph removal", async (t) => {
  const { window, graph } = await setup(t);
  window.document.body.insertAdjacentHTML("afterbegin", summaryHTML);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  canvas.insertAdjacentHTML("afterbegin", workflowInfoHTML);
  const info = canvas.firstElementChild;
  await settle();
  const summary = window.document.querySelector(".actions-workflow-stats");
  summary.innerHTML =
    '<div class="d-flex flex-wrap"><div>Status: In progress</div></div>';
  await settle();
  assert.equal(summary.firstElementChild.lastElementChild, info);
  assert.equal(summary.querySelectorAll('a[href$="/workflow"]').length, 1);
  graph.remove();
  await settle();
  assert.equal(summary.contains(info), false);
  assert.match(summary.textContent, /Status: In progress/);
});

test("keeps workflow info in the graph until the run summary is available", async (t) => {
  const { window, graph } = await setup(t);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  canvas.insertAdjacentHTML("afterbegin", workflowInfoHTML);
  const info = canvas.firstElementChild;
  await settle();
  assert.equal(info.parentElement, canvas);
  window.document.body.insertAdjacentHTML("afterbegin", summaryHTML);
  await settle();
  assert.equal(
    window.document.querySelector(".actions-workflow-stats > .d-flex")
      .lastElementChild,
    info
  );
});

test("preserves moved workflow info when the graph's canvas or stages are replaced", async (t) => {
  const { window, graph } = await setup(t);
  window.document.body.insertAdjacentHTML("afterbegin", summaryHTML);
  const canvas = graph.querySelector('[data-target="action-graph.canvas"]');
  canvas.insertAdjacentHTML("afterbegin", workflowInfoHTML);
  const info = canvas.firstElementChild;
  await settle();
  canvas.replaceWith(canvas.cloneNode(true));
  await settle();
  const summary = window.document.querySelector(".actions-workflow-stats");
  assert.equal(summary.querySelector(".gha-run-workflow-info"), info);
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.replaceWith(stages.cloneNode(true));
  await settle();
  summary.firstElementChild.replaceChildren();
  await settle();
  assert.equal(summary.querySelector(".gha-run-workflow-info"), info);
  graph.querySelector('[data-target="action-graph.stages"]').remove();
  await settle();
  graph.remove();
  await settle();
  assert.equal(summary.contains(info), false);
});

function statusJob(name, status) {
  const labels = {
    completed: "completed successfully: ",
    failed: "failed: ",
    skipped: "skipped: ",
    cancelled: "cancelled: ",
    active: "in progress: ",
    pending: "queued: ",
    waiting: "waiting: ",
    "action-required": "action required: ",
    "timed-out": "timed out: ",
  };
  return `<streaming-graph-job data-concluded="${![
    "active",
    "pending",
    "waiting",
  ].includes(status)}" class="WorkflowJob">
    <a class="WorkflowJob-title" href="/owner/repo/actions/runs/123/job/${name}">
      <svg aria-label="${labels[status]}"></svg><span>${name}</span>
    </a></streaming-graph-job>`;
}

function statusCard(name, status) {
  return `<div class="WorkflowCard" id="${name}">${statusJob(
    name,
    status
  )}</div>`;
}

async function statusSetup(t, markup) {
  const result = await setup(t);
  const style = result.window.document.createElement("style");
  style.textContent = styles.join("\n");
  result.window.document.head.append(style);
  result.graph.querySelector(".WorkflowStage").innerHTML = markup;
  await settle();
  return result;
}

function statusCheckbox(graph, status) {
  return graph.querySelector(
    `.gha-run-controls input[type="checkbox"][value="${status}"]`
  );
}

test("Filter jobs shows selected statuses in its trigger without adding a chip row", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("ok", "completed"));
  const filter = graph.querySelector(".gha-run-hide-filter");
  assert.ok(filter);
  assert.equal(filter.tagName, "DETAILS");
  assert.equal(filter.open, false);
  assert.match(filter.querySelector("summary").textContent, /Filter jobs/);
  assert.equal(
    filter.querySelector('[role="group"]').getAttribute("aria-label"),
    "Filter jobs by status"
  );
  assert.equal(graph.querySelector(".gha-run-hide-trigger .Counter"), null);
  assert.equal(graph.querySelector(".gha-run-filter-chips"), null);
  const options = Array.from(filter.querySelectorAll('input[type="checkbox"]'));
  assert.deepEqual(
    options.map((option) => option.value),
    [
      "completed",
      "failed",
      "waiting",
      "active",
      "action-required",
      "cancelled",
      "skipped",
      "timed-out",
    ]
  );
  assert.equal(
    options.every((option) => !option.checked),
    true
  );
  for (const option of options) {
    assert.ok(option.labels[0].textContent.trim());
    assert.ok(option.labels[0].querySelector('svg[aria-hidden="true"]'));
  }
  filter.open = true;
  statusCheckbox(graph, "completed").click();
  statusCheckbox(graph, "failed").click();
  await settle();
  assert.equal(filter.open, true);
  assert.equal(filter.querySelector("summary").textContent.trim(), "2 selected");
  assert.equal(
    filter.querySelector("summary").getAttribute("aria-label"),
    "Filter jobs: 2 selected"
  );
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#ok")).display,
    "none"
  );
  statusCheckbox(graph, "completed").click();
  await settle();
  assert.equal(statusCheckbox(graph, "completed").checked, false);
  assert.equal(statusCheckbox(graph, "failed").checked, true);
  assert.equal(filter.querySelector("summary").textContent.trim(), "Failed");
  assert.equal(
    window.getComputedStyle(graph.querySelector("#ok")).display,
    "none"
  );
  filter.querySelector("button").click();
  await settle();
  assert.equal(
    options.every((option) => !option.checked),
    true
  );
  assert.equal(filter.querySelector("summary").textContent.trim(), "Filter jobs");
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#ok")).display,
    "none"
  );
  const mutations = [];
  const observer = new window.MutationObserver((records) =>
    mutations.push(...records)
  );
  observer.observe(filter, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  await settle();
  await settle();
  assert.equal(
    mutations.length,
    0,
    "idle refresh does not continuously mutate the filter"
  );
});

test("the filter trigger keeps a long selected status readable in a compact label", async (t) => {
  const { graph } = await statusSetup(t, statusCard("review", "waiting"));
  statusCheckbox(graph, "action-required").click();
  await settle();
  const trigger = graph.querySelector(".gha-run-hide-trigger");
  assert.equal(trigger.textContent.trim(), "Action required");
  assert.equal(
    trigger.getAttribute("aria-label"),
    "Filter jobs: Action required"
  );
});

test("filtering hides empty stages without renumbering matching stages", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("first", "completed"));
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.insertAdjacentHTML(
    "beforeend",
    `<div class="WorkflowStage">${statusCard("second", "failed")}</div>` +
      `<div class="WorkflowStage">${statusCard("third", "completed")}</div>`
  );
  await settle();
  statusCheckbox(graph, "failed").click();
  await settle();

  const columns = stages.querySelectorAll(":scope > .WorkflowStage");
  assert.deepEqual(
    Array.from(
      columns,
      (stage) => stage.querySelector(".gha-run-stage-badge").textContent
    ),
    ["Stage 1", "Stage 2", "Stage 3"]
  );
  assert.equal(window.getComputedStyle(columns[0]).display, "none");
  assert.notEqual(window.getComputedStyle(columns[1]).display, "none");
  assert.equal(window.getComputedStyle(columns[2]).display, "none");
  assert.equal(
    window.getComputedStyle(graph.querySelector("#first")).display,
    "none"
  );
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#second")).display,
    "none"
  );
  assert.equal(
    graph.querySelector("[role='status']").textContent,
    "1 matching job card"
  );

  graph.querySelector(".gha-run-hide-heading button").click();
  await settle();
  assert.equal(
    Array.from(columns).every((stage) => window.getComputedStyle(stage).display !== "none"),
    true
  );
  assert.equal(graph.querySelector("[role='status']").textContent, "");
});

test("status options count jobs, including collapsed matrices and review waits", async (t) => {
  const review = statusJob("review", "waiting").replace(
    "</a>",
    "</a><span>waiting for review</span>"
  );
  const { window, graph } = await statusSetup(
    t,
    statusCard("done", "completed") +
      statusCard("failed", "failed") +
      `<div class="WorkflowCard" id="review">${review}</div>` +
      `<div class="WorkflowCard WorkflowCard-group" id="collapsed"><button class="WorkflowJob"><div class="MatrixComponent-collapse--title"><svg aria-label="completed successfully: "></svg>4 jobs completed</div></button></div>` +
      `<div class="WorkflowCard WorkflowCard-group" id="expanded">${statusJob("matrix-done", "completed")}${statusJob("matrix-skip", "skipped")}</div>`
  );
  const count = (status) => {
    const label = statusCheckbox(graph, status).labels[0];
    const number = label.querySelector(".gha-run-hide-count");
    assert.equal(label.lastElementChild, number);
    return Number(number.textContent);
  };
  const statuses = [
    "completed",
    "failed",
    "waiting",
    "active",
    "action-required",
    "cancelled",
    "skipped",
    "timed-out",
  ];
  assert.deepEqual(
    Object.fromEntries(statuses.map((status) => [status, count(status)])),
    {
      completed: 6,
      failed: 1,
      waiting: 1,
      active: 0,
      "action-required": 1,
      cancelled: 0,
      skipped: 1,
      "timed-out": 0,
    }
  );
  statusCheckbox(graph, "failed").click();
  await settle();
  assert.equal(count("completed"), 6);
  graph
    .querySelector("#failed svg")
    .setAttribute("aria-label", "completed successfully: ");
  await settle();
  assert.equal(count("completed"), 7);
  assert.equal(count("failed"), 0);
  addRunStatus(window, "Success");
  await settle();
  assert.equal(count("waiting"), 1);
  assert.equal(count("skipped"), 2);
});

test("collapsed failed matrices show a lower bound until child statuses load", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    `<div class="WorkflowCard WorkflowCard-group" id="matrix"><div class="js-graph-matrix"><button class="WorkflowJob"><div class="MatrixComponent-collapse--title"><svg aria-label="failed: "></svg>13 jobs completed</div></button></div></div>`
  );
  const count = (status) =>
    statusCheckbox(graph, status).labels[0].querySelector(".gha-run-hide-count")
      .textContent;
  assert.equal(count("failed"), "1+");
  statusCheckbox(graph, "failed").click();
  await settle();
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#matrix")).display,
    "none"
  );

  const matrix = graph.querySelector("#matrix .js-graph-matrix");
  matrix.innerHTML =
    statusJob("failure", "failed") +
    Array.from({ length: 12 }, (_, index) =>
      statusJob(`success-${index}`, "completed")
    ).join("");
  await settle();
  assert.equal(count("failed"), "1");
  assert.equal(count("completed"), "12");
  const row = (name) =>
    matrix.querySelector(`a[href$="/${name}"]`).closest("streaming-graph-job");
  assert.notEqual(window.getComputedStyle(row("failure")).display, "none");
  assert.equal(
    window.getComputedStyle(row("success-0")).display,
    "none"
  );
});

test("combines job-name search with selected statuses", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    statusCard("Deploy API", "completed") +
      statusCard("Build UI", "skipped") +
      `<div class="WorkflowCard WorkflowCard-group" id="matrix"><div class="WorkflowCard-heading"><span class="WorkflowCard-heading--content">Matrix: Test Agents</span></div><div class="js-graph-matrix">${statusJob(
        "Python",
        "completed"
      )}${statusJob("Node", "failed")}</div></div>`
  );
  const search = graph.querySelector('input[aria-label="Search jobs"]');
  const clearSearch = graph.querySelector('.gha-run-job-search-clear');
  assert.ok(search);
  assert.equal(search.nextElementSibling, clearSearch);
  assert.equal(clearSearch.hidden, true);
  const visible = (selector) => {
    const element = graph.querySelector(selector);
    return (
      window.getComputedStyle(element.closest("streaming-graph-job") ?? element)
        .display !== "none"
    );
  };
  const type = async (value) => {
    search.value = value;
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  search.value = "build";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 125));
  search.value = "dEpLoY";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 170));
  assert.equal(visible("#Build\\ UI"), true, "search waits while typing");
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(clearSearch.hidden, false);
  assert.equal(visible("#Deploy\\ API"), true);
  assert.equal(visible("#Build\\ UI"), false);
  assert.equal(visible("#matrix"), false);

  await type("python");
  assert.equal(visible("#matrix"), true);
  assert.equal(visible('a[href$="/Python"]'), true);
  assert.equal(visible('a[href$="/Node"]'), false);

  await type("TEST AGENTS");
  assert.equal(visible('a[href$="/Python"]'), true);
  assert.equal(visible('a[href$="/Node"]'), true);
  statusCheckbox(graph, "completed").click();
  await settle();
  assert.equal(visible('a[href$="/Python"]'), true);
  assert.equal(visible('a[href$="/Node"]'), false);

  await type("react");
  assert.equal(visible("#matrix"), false);
  graph.querySelector('a[href$="/Node"] span').textContent = "React";
  await settle();
  assert.equal(visible("#matrix"), false);
  statusCheckbox(graph, "failed").click();
  await settle();
  assert.equal(visible("#matrix"), true);

  await type("no match");
  assert.equal(visible(".WorkflowStage"), false);
  assert.equal(graph.querySelector("[role='status']").textContent, "0 matching job cards");
  clearSearch.click();
  await settle();
  assert.equal(search.value, "");
  assert.equal(clearSearch.hidden, true);
  assert.equal(window.document.activeElement, search);
  assert.equal(visible("#Build\\ UI"), false);
  assert.equal(visible('a[href$="/Python"]'), true);

  search.value = "ui";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  window.history.pushState({}, "", "/owner/repo/actions/runs/124");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(search.value, "");
  assert.equal(visible("#Deploy\\ API"), true);
});

test("status selections show matching jobs, including failed jobs inside matrices", async (t) => {
  const statuses = [
    "completed",
    "failed",
    "waiting",
    "active",
    "action-required",
    "cancelled",
    "skipped",
    "timed-out",
  ];
  const { window, graph } = await statusSetup(
    t,
    statuses.map((status) => statusCard(status, status)).join("") +
      `<div class="WorkflowCard WorkflowCard-group" id="mixed"><div class="js-graph-matrix">${statusJob(
        "matrix-success",
        "completed"
      )}${statusJob("matrix-failure", "failed")}</div></div>`
  );
  for (const status of statuses) {
    const option = statusCheckbox(graph, status);
    assert.ok(option, status);
    option.click();
    await settle();
    for (const other of statuses) {
      assert.equal(
        window.getComputedStyle(graph.querySelector(`#${other}`)).display ===
          "none",
        other !== status,
        `${status}: ${other}`
      );
    }
    option.click();
    await settle();
  }
  statusCheckbox(graph, "failed").click();
  await settle();
  const matrixRow = (name) =>
    graph.querySelector(`a[href$="/${name}"]`).closest("streaming-graph-job");
  assert.notEqual(
    window.getComputedStyle(matrixRow("matrix-failure")).display,
    "none"
  );
  assert.equal(
    window.getComputedStyle(matrixRow("matrix-success")).display,
    "none"
  );
  statusCheckbox(graph, "completed").click();
  await settle();
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#mixed")).display,
    "none"
  );
});

test("waiting for review matches Waiting and Action required", async (t) => {
  const reviewJob = statusJob("review", "waiting").replace(
    "</a>",
    "</a><span>waiting for review</span>"
  );
  const { window, graph } = await statusSetup(
    t,
    `<div class="WorkflowCard" id="review">${reviewJob}</div>` +
      statusCard("queued", "waiting")
  );
  const visible = (id) =>
    window.getComputedStyle(graph.querySelector(`#${id}`)).display !== "none";
  const actionRequired = statusCheckbox(graph, "action-required");
  actionRequired.click();
  await settle();
  assert.equal(visible("review"), true);
  assert.equal(visible("queued"), false);
  actionRequired.click();
  statusCheckbox(graph, "waiting").click();
  await settle();
  assert.equal(visible("review"), true);
  assert.equal(visible("queued"), true);
});

test("Waiting can show finished-run placeholders independently of Skipped", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    pendingMatrixHTML + statusCard("skip", "skipped")
  );
  addRunStatus(window, "Success");
  const waiting = statusCheckbox(graph, "waiting");
  assert.ok(waiting);
  waiting.click();
  await settle();
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#pending-matrix")).display,
    "none"
  );
  assert.equal(
    window.getComputedStyle(graph.querySelector("#skip")).display,
    "none"
  );
});

test("dropdown dismisses on Escape and outside clicks without changing selections", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("ok", "completed"));
  const filter = graph.querySelector(".gha-run-hide-filter");
  assert.ok(filter);
  filter.open = true;
  const option = statusCheckbox(graph, "completed");
  option.focus();
  option.click();
  await settle();
  option.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
  );
  assert.equal(filter.open, false);
  assert.equal(window.document.activeElement, filter.querySelector("summary"));
  assert.equal(option.checked, true);
  filter.open = true;
  graph.querySelector(".WorkflowCard").click();
  assert.equal(filter.open, false);
  assert.equal(option.checked, true);
});

test("groups each column visually as completed, active, skipped, cancelled without moving native cards", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    statusCard("cancel", "cancelled") +
      statusCard("skip", "skipped") +
      statusCard("ok", "completed") +
      statusCard("failed", "failed") +
      statusCard("running", "active")
  );
  graph.querySelector(".gha-run-group-toggle").click();
  await settle();
  const stage = graph.querySelector(".WorkflowStage");
  const cards = Array.from(stage.querySelectorAll(":scope > .WorkflowCard"));
  const visual = [...cards].sort(
    (a, b) =>
      Number(window.getComputedStyle(a).order) -
      Number(window.getComputedStyle(b).order)
  );
  assert.deepEqual(
    visual.map((card) => card.id),
    ["ok", "failed", "running", "skip", "cancel"]
  );
  assert.deepEqual(
    cards.map((card) => card.id),
    ["cancel", "skip", "ok", "failed", "running"]
  );
  const headings = Array.from(
    stage.querySelectorAll(".gha-run-status-heading")
  );
  assert.deepEqual(
    headings.map((heading) => heading.textContent),
    ["Completed", "Active / pending", "Skipped", "Cancelled"]
  );
  assert.deepEqual(
    Array.from(
      stage.querySelectorAll(":scope > .gha-run-stage-badge"),
      (badge) => badge.textContent
    ),
    ["Stage 1"]
  );
  assert.equal(stage.firstElementChild.className, "gha-run-stage-badge");
  assert.equal(
    stage.firstElementChild.firstElementChild.className,
    "gha-run-stage-badge-label"
  );
  assert.equal(window.getComputedStyle(stage.firstElementChild).position, "sticky");
  assert.equal(window.getComputedStyle(headings[0]).top, "28px");
  assert.equal(
    headings.every(
      (heading) =>
        heading.tagName === "BUTTON" &&
        heading.getAttribute("aria-expanded") === "true"
    ),
    true
  );
});

test("numbers workflow stages and collapses each status group independently", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    statusCard("first-done", "completed") +
      statusCard("first-skip", "skipped")
  );
  graph.querySelector(".gha-run-group-toggle").click();
  await settle();
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.insertAdjacentHTML(
    "beforeend",
    `<div class="WorkflowStage">${statusCard("second-done", "completed")}</div>`
  );
  await settle();
  const first = stages.querySelectorAll(":scope > .WorkflowStage")[0];
  const second = stages.querySelectorAll(":scope > .WorkflowStage")[1];
  const heading = (stage, status) =>
    stage.querySelector(`.gha-run-status-heading[data-status="${status}"]`);
  assert.equal(
    first.querySelector(":scope > .gha-run-stage-badge").textContent,
    "Stage 1"
  );
  assert.equal(
    second.querySelector(":scope > .gha-run-stage-badge").textContent,
    "Stage 2"
  );
  assert.equal(heading(first, "completed").textContent, "Completed");
  assert.equal(heading(first, "skipped").textContent, "Skipped");
  assert.equal(heading(second, "completed").textContent, "Completed");
  heading(first, "completed").click();
  await settle();
  assert.equal(heading(first, "completed").getAttribute("aria-expanded"), "false");
  assert.equal(window.getComputedStyle(first.querySelector("#first-done")).display, "none");
  assert.notEqual(window.getComputedStyle(first.querySelector("#first-skip")).display, "none");
  assert.notEqual(window.getComputedStyle(second.querySelector("#second-done")).display, "none");
  first
    .querySelector("#first-done")
    .replaceWith(
      window.document
        .createRange()
        .createContextualFragment(statusCard("new-done", "completed"))
    );
  await settle();
  assert.equal(window.getComputedStyle(first.querySelector("#new-done")).display, "none");
  assert.equal(first.querySelectorAll(":scope > .gha-run-stage-badge").length, 1);
  heading(first, "completed").click();
  await settle();
  assert.equal(heading(first, "completed").getAttribute("aria-expanded"), "true");
  assert.notEqual(window.getComputedStyle(first.querySelector("#new-done")).display, "none");
});

test("keeps original stage numbers when earlier filtered stages leave the graph", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("first", "completed"));
  const stages = graph.querySelector('[data-target="action-graph.stages"]');
  stages.insertAdjacentHTML(
    "beforeend",
    `<div class="WorkflowStage">${statusCard("second", "completed")}</div>
     <div class="WorkflowStage">${statusCard("scan-third", "completed")}</div>
     <div class="WorkflowStage">${statusCard("scan-fourth", "completed")}</div>`
  );
  await settle();
  const search = graph.querySelector(".gha-run-job-search");
  search.value = "scan";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const visibleNumbers = () =>
    Array.from(
      stages.querySelectorAll(":scope > .WorkflowStage:not([data-gha-status-hidden])"),
      (stage) => stage.querySelector(".gha-run-stage-badge").textContent
    );
  assert.deepEqual(visibleNumbers(), ["Stage 3", "Stage 4"]);
  assert.equal(stages.querySelectorAll(":scope > .WorkflowStage").length, 4);
  stages.querySelectorAll(":scope > .WorkflowStage")[1].remove();
  await settle();
  assert.deepEqual(visibleNumbers(), ["Stage 3", "Stage 4"]);
  stages.querySelectorAll(":scope > .WorkflowStage")[1].outerHTML =
    `<div class="WorkflowStage">${statusCard("scan-third", "completed")}</div>`;
  await settle();
  assert.deepEqual(visibleNumbers(), ["Stage 3", "Stage 4"]);
  const holder = window.document.createElement("div");
  holder.innerHTML = graphHTML;
  const replacement = holder.firstElementChild;
  const replacementStages = replacement.querySelector(
    '[data-target="action-graph.stages"]'
  );
  replacementStages.innerHTML =
    `<div class="WorkflowStage">${statusCard("scan-third", "completed")}</div>` +
    `<div class="WorkflowStage">${statusCard("scan-fourth", "completed")}</div>`;
  graph.replaceWith(replacement);
  await settle();
  assert.deepEqual(
    Array.from(
      replacementStages.querySelectorAll(":scope > .WorkflowStage"),
      (stage) => stage.querySelector(".gha-run-stage-badge").textContent
    ),
    ["Stage 3", "Stage 4"]
  );
});

test("settings toggle restores native card order and disables status groups without affecting filters", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    statusCard("skip", "skipped") + statusCard("done", "completed")
  );
  const stage = graph.querySelector(".WorkflowStage");
  const skipped = stage.querySelector("#skip");
  const completed = stage.querySelector("#done");
  const heading = stage.querySelector('.gha-run-status-heading[data-status="skipped"]');
  const toggle = graph.querySelector(".gha-run-group-toggle");
  assert.deepEqual(
    Array.from(
      graph.querySelectorAll(".gha-run-settings-menu > .gha-run-setting"),
      (setting) => setting.firstElementChild.textContent
    ),
    ["Highlight related jobs on hover", "Group by status", "Search and filter", "Scroll arrows"]
  );
  assert.equal(toggle.previousElementSibling.textContent, "Group by status");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.textContent, "Off");
  assert.equal(skipped.style.order, "");
  assert.equal(window.getComputedStyle(heading).display, "none");
  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.textContent, "On");
  assert.equal(skipped.style.order, "5");
  heading.click();
  await settle();
  assert.equal(window.getComputedStyle(skipped).display, "none");

  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.textContent, "Off");
  assert.equal(window.getComputedStyle(heading).display, "none");
  assert.equal(skipped.style.order, "");
  assert.equal(completed.style.order, "");
  assert.notEqual(window.getComputedStyle(skipped).display, "none");
  assert.equal(stage.querySelector(".gha-run-stage-badge").textContent, "Stage 1");

  statusCheckbox(graph, "completed").click();
  await settle();
  assert.equal(window.getComputedStyle(skipped).display, "none");
  assert.notEqual(window.getComputedStyle(completed).display, "none");
  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(completed.style.order, "1");
  assert.equal(heading.getAttribute("aria-expanded"), "true");
  assert.equal(window.getComputedStyle(heading).display, "none");
  statusCheckbox(graph, "completed").click();
  await settle();
  assert.notEqual(window.getComputedStyle(heading).display, "none");
  assert.notEqual(window.getComputedStyle(skipped).display, "none");
});

test("skipped and cancelled selections combine and restore original nodes", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    statusCard("cancel", "cancelled") +
      statusCard("skip", "skipped") +
      statusCard("completed-cancelled-cleanup", "completed")
  );
  const skipped = graph.querySelector("#skip");
  const cancelled = graph.querySelector("#cancel");
  const completed = graph.querySelector("#completed-cancelled-cleanup");
  const skipButton = statusCheckbox(graph, "skipped");
  const cancelButton = statusCheckbox(graph, "cancelled");
  assert.ok(skipButton);
  assert.ok(cancelButton);
  skipButton.click();
  await settle();
  assert.equal(skipButton.checked, true);
  assert.notEqual(window.getComputedStyle(skipped).display, "none");
  assert.equal(window.getComputedStyle(cancelled).display, "none");
  assert.equal(window.getComputedStyle(completed).display, "none");
  cancelButton.click();
  await settle();
  assert.notEqual(window.getComputedStyle(cancelled).display, "none");
  skipButton.click();
  await settle();
  assert.equal(window.getComputedStyle(skipped).display, "none");
  assert.equal(graph.querySelector("#skip"), skipped);
  assert.notEqual(window.getComputedStyle(cancelled).display, "none");
  assert.equal(graph.querySelectorAll(".gha-run-controls").length, 1);
});

test("filters matrix rows individually and shows selected groups", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    `<div class="WorkflowCard WorkflowCard-group" id="mixed"><div class="js-graph-matrix"><div class="d-flex flex-column">
      ${statusJob("matrix-success", "completed")}${statusJob(
      "matrix-skip",
      "skipped"
    )}${statusJob("matrix-cancel", "cancelled")}
    </div></div></div>
    <div class="WorkflowCard WorkflowCard-group" id="collapsed"><div class="js-graph-matrix"><button class="WorkflowJob">
      <div class="MatrixComponent-collapse--title"><svg aria-label="skipped: "></svg>2 jobs completed</div>Show all jobs
    </button></div></div>`
  );
  graph.querySelector(".gha-run-group-toggle").click();
  await settle();
  statusCheckbox(graph, "skipped").click();
  statusCheckbox(graph, "cancelled").click();
  await settle();
  const row = (name) =>
    graph.querySelector(`a[href$="/${name}"]`).closest("streaming-graph-job");
  assert.notEqual(window.getComputedStyle(row("matrix-skip")).display, "none");
  assert.notEqual(
    window.getComputedStyle(row("matrix-cancel")).display,
    "none"
  );
  assert.equal(window.getComputedStyle(row("matrix-success")).display, "none");
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#mixed")).display,
    "none"
  );
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#collapsed")).display,
    "none"
  );
  const skippedHeading = Array.from(
    graph.querySelectorAll(".gha-run-status-heading")
  ).find((heading) => heading.dataset.status === "skipped");
  assert.notEqual(window.getComputedStyle(skippedHeading).display, "none");
});

test("matrix children show their leaf names while keeping full names searchable", async (t) => {
  const fullName = "Base-agent coverage scans / ... / Base Agent Sonar Scan";
  const { window, graph } = await statusSetup(
    t,
    `<div class="WorkflowCard WorkflowCard-group" id="matrix"><div class="WorkflowCard-heading">Matrix: scans</div><div class="js-graph-matrix">
      <streaming-graph-job class="WorkflowJob" data-concluded="true"><a class="WorkflowJob-title" href="/owner/repo/actions/runs/123/job/sonar"><svg aria-label="completed successfully: "></svg><span data-target="streaming-graph-job.name">${fullName}</span></a></streaming-graph-job>
    </div></div>`
  );
  const link = graph.querySelector("#matrix .WorkflowJob-title");
  const name = link.querySelector('[data-target="streaming-graph-job.name"]');
  assert.equal(name.textContent, "Base Agent Sonar Scan");
  assert.equal(name.title, fullName);
  assert.match(link.getAttribute("aria-label"), /Base-agent coverage scans/);
  const search = graph.querySelector(".gha-run-job-search");
  search.value = "Base-agent coverage scans";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#matrix")).display,
    "none"
  );
  name.textContent = "Base-agent coverage scans / ... / Black Duck";
  await settle();
  assert.equal(name.textContent, "Black Duck");
  assert.equal(name.title, "Base-agent coverage scans / ... / Black Duck");
});

test("matrix children with split GitHub names show only the final segment", async (t) => {
  const fullName =
    "Mobile integration tests / iOS predeploy Tests / iOS Real Device Smoke Tests";
  const { window, graph } = await statusSetup(
    t,
    `<div class="WorkflowCard WorkflowCard-group" id="matrix"><div class="WorkflowCard-heading">Matrix: ios_tests</div><div class="js-graph-matrix">
      <streaming-graph-job class="WorkflowJob" data-concluded="true">
        <a class="WorkflowJob-title" href="/owner/repo/actions/runs/123/job/ios" aria-describedby="full-job-name">
          <svg aria-label="failed: "></svg><div class="d-flex css-truncate-overflow">
            <span data-target="streaming-graph-job.name">Mobile integration tests&nbsp;</span><span>/</span><span data-target="streaming-graph-job.ellipsis">&nbsp;...&nbsp;</span><span>/</span><span>&nbsp;iOS Real Device Smoke Tests</span>
          </div>
        </a><tool-tip id="full-job-name">${fullName}</tool-tip>
      </streaming-graph-job>
    </div></div>`
  );
  const link = graph.querySelector("#matrix .WorkflowJob-title");
  const parts = link.querySelectorAll(".css-truncate-overflow > span");
  for (const part of Array.from(parts).slice(0, -1))
    assert.equal(window.getComputedStyle(part).display, "none");
  assert.notEqual(
    window.getComputedStyle(parts[parts.length - 1]).display,
    "none"
  );
  assert.equal(graph.querySelector("#full-job-name").textContent, fullName);
  const search = graph.querySelector(".gha-run-job-search");
  search.value = "iOS predeploy Tests";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#matrix")).display,
    "none"
  );
});

test("live status changes reclassify filtered jobs and controls survive native graph replacement", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    statusCard("changing", "skipped")
  );
  statusCheckbox(graph, "skipped").click();
  await settle();
  const card = graph.querySelector("#changing");
  assert.notEqual(window.getComputedStyle(card).display, "none");
  card
    .querySelector("svg")
    .setAttribute("aria-label", "completed successfully: ");
  await settle();
  assert.equal(window.getComputedStyle(card).display, "none");
  card.querySelector("svg").setAttribute("aria-label", "skipped: ");
  await settle();
  const holder = window.document.createElement("div");
  holder.innerHTML = graphHTML;
  const replacement = holder.firstElementChild;
  replacement.querySelector(".WorkflowStage").innerHTML = statusCard(
    "changing",
    "skipped"
  );
  graph.replaceWith(replacement);
  await settle();
  assert.equal(statusCheckbox(replacement, "skipped").checked, true);
  assert.notEqual(
    window.getComputedStyle(replacement.querySelector("#changing")).display,
    "none"
  );
  assert.equal(replacement.querySelectorAll(".gha-run-controls").length, 1);
  window.history.pushState({}, "", "/owner/repo/actions/runs/124");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle();
  assert.equal(statusCheckbox(replacement, "skipped").checked, false);
});

const runSectionsHTML = `<div class="js-updatable-content" data-url="/owner/repo/actions/runs/123/annotations_partial">
  <div class="actions-fullwidth-module color-bg-default color-shadow-small border rounded" id="annotations-section">
    <div><div><h2>Annotations</h2><div>1 error</div></div></div>
    <table><tbody><tr><td><annotation-message><button>Show more</button></annotation-message></td></tr></tbody></table>
  </div></div>
  <div class="js-updatable-content" data-url="/owner/repo/actions/runs/123/artifacts_partial" id="artifacts">
  <div class="actions-fullwidth-module color-bg-default color-shadow-small border rounded" id="artifacts-section">
      <div><div><h2>Artifacts</h2><div>Produced during runtime</div></div></div>
      <table><tbody><tr><td><a href="/download.zip">Download artifact</a></td></tr></tbody></table>
    </div></div>
  <job-summary id="job-summary-456" class="actions-job-summary actions-fullwidth-module d-block color-bg-default Box rounded tmp-mb-3" data-content-path="/owner/repo/actions/runs/123/jobs/456/summary_content">
    <div class="tmp-mb-3 tmp-pl-3 pr-1 border-bottom color-bg-subtle">
      <div class="d-flex flex-items-center mx-0 mx-md-1 py-2">
        <h2 class="flex-1 text-semibold my-1 h4"><a class="Link--primary" href="#job-summary-456">Resolve Workflow Modes summary</a></h2>
        <details-toggle><details><summary role="button" aria-label="job summary options">Options</summary><details-menu role="menu"><a role="menuitem" href="/owner/repo/actions/runs/123/job/456">View job logs</a></details-menu></details></details-toggle>
      </div></div>
    <div class="mx-1 tmp-px-3 tmp-pb-3"><div class="markdown-body"><h2>Prompt-only classification</h2><a href="/owner/repo/pull/42">Source: PR #42</a></div></div>
  </job-summary>`;

const approvalSectionHTML = `<div class="js-updatable-content" data-url="/owner/repo/actions/runs/123/approvals_partial">
  <div class="actions-fullwidth-module" id="approvals-section">
    <div class="d-flex flex-justify-between"><div>
      <h2>Deployment protection rules</h2>
      <div>Reviewers, timers, and other rules protecting deployments in this run</div>
    </div><div></div></div>
    <table><tbody><tr><td>requested review</td></tr></tbody></table>
  </div></div>`;

test("deployment protection rules use the same collapsible header", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("ok", "completed"));
  graph.insertAdjacentHTML("afterend", approvalSectionHTML);
  await settle();
  const section = window.document.querySelector("#approvals-section");
  const table = section.querySelector("table");
  const toggle = section.querySelector(".gha-run-section-toggle");
  assert.ok(toggle);
  assert.equal(toggle.textContent, "Deployment protection rules");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(window.getComputedStyle(table).display, "none");
  assert.notEqual(
    window.getComputedStyle(
      section.querySelector(".gha-run-section-header h2 + div")
    ).display,
    "none"
  );
  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.notEqual(window.getComputedStyle(table).display, "none");
  const replacement = window.document.createElement("div");
  replacement.innerHTML = approvalSectionHTML;
  section.replaceWith(replacement.querySelector("#approvals-section"));
  await settle();
  const updated = window.document.querySelector("#approvals-section");
  assert.equal(
    updated.querySelector(".gha-run-section-toggle").getAttribute("aria-expanded"),
    "true"
  );
});

test("artifacts, annotations, and one shared Summaries section start collapsed", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("ok", "completed"));
  const nativeSummaryStyle = window.document.createElement("style");
  nativeSummaryStyle.textContent = "job-summary.actions-job-summary { background-color: rgb(35, 40, 48); } div.color-bg-default { background-color: rgb(13, 17, 23) !important; } .border { border: 1px solid rgb(61, 68, 77); } .rounded { border-radius: 6px; }";
  window.document.head.append(nativeSummaryStyle);
  graph.insertAdjacentHTML("afterend", runSectionsHTML);
  window.document.body.insertAdjacentHTML("afterbegin", summaryHTML);
  await settle();
  const sections = window.document.querySelectorAll(".gha-run-section");
  assert.equal(sections.length, 3);
  assert.equal(
    window.document.querySelectorAll(".gha-run-summaries").length,
    1
  );
  assert.ok(
    window.document.querySelector(
      ".gha-run-summaries.actions-fullwidth-module.color-bg-default.color-shadow-small.border.rounded"
    )
  );
  const summariesCard = window.document.querySelector(".gha-run-summaries");
  const nativeCard = window.document.querySelector("#annotations-section");
  const header = summariesCard.querySelector(":scope > .gha-run-section-header");
  assert.equal(window.getComputedStyle(summariesCard).backgroundColor,
    window.getComputedStyle(nativeCard).backgroundColor);
  assert.notEqual(window.getComputedStyle(summariesCard).background,
    "var(--bgColor-inset, var(--color-canvas-inset, #010409))");
  assert.equal(window.getComputedStyle(summariesCard).border,
    window.getComputedStyle(nativeCard).border);
  assert.equal(window.getComputedStyle(summariesCard).borderRadius,
    window.getComputedStyle(nativeCard).borderRadius);
  assert.notEqual(window.getComputedStyle(header).background,
    "var(--bgColor-inset, var(--color-canvas-inset, #010409))");
  assert.equal(
    window.getComputedStyle(window.document.querySelector(".gha-run-summaries job-summary")).backgroundColor,
    "rgb(35, 40, 48)"
  );
  assert.equal(
    window.document.querySelector("job-summary .gha-run-section-toggle"),
    null
  );
  assert.equal(
    window.document.querySelector(".gha-run-summaries .gha-run-section-toggle")
      .textContent,
    "Summaries"
  );
  assert.ok(
    window.document.querySelector('job-summary h2 > a[href="#job-summary-456"]')
  );
  for (const section of sections) {
    const button = section.querySelector(".gha-run-section-toggle");
    assert.ok(button);
    assert.equal(button.type, "button");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.notEqual(window.getComputedStyle(button).display, "none");
    assert.equal(
      window.getComputedStyle(section.lastElementChild).display,
      "none"
    );
  }
  window.document.querySelector(".gha-run-summaries .gha-run-section-toggle").click();
  await settle();
  assert.equal(
    window.getComputedStyle(summariesCard).background,
    "var(--bgColor-inset, var(--color-canvas-inset, #010409))"
  );
  assert.equal(window.getComputedStyle(header).background,
    "var(--bgColor-default, #0d1117)");
  assert.equal(parseFloat(window.getComputedStyle(header).borderBottomWidth) || 0,
    parseFloat(window.getComputedStyle(nativeCard.firstElementChild).borderBottomWidth) || 0);
  assert.equal(
    window.document.querySelector(
      ".actions-workflow-stats .gha-run-section-toggle"
    ),
    null
  );
  assert.equal(graph.querySelector(".gha-run-section-toggle"), null);
  assert.equal(
    window.document.querySelectorAll(".markdown-body .gha-run-section-toggle")
      .length,
    0
  );
});

test("section controls preserve native content and open state through updates and cached navigation", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("ok", "completed"));
  graph.insertAdjacentHTML("afterend", runSectionsHTML);
  const annotations = window.document.querySelector("#annotations-section");
  const table = annotations.querySelector("table");
  const nativeButton = table.querySelector("button");
  let nativeClicks = 0;
  nativeButton.addEventListener("click", () => nativeClicks++);
  await settle();
  const toggle = annotations.querySelector(".gha-run-section-toggle");
  assert.ok(toggle);
  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.notEqual(window.getComputedStyle(table).display, "none");
  assert.equal(annotations.querySelector("table"), table);
  nativeButton.click();
  assert.equal(nativeClicks, 1);
  assert.equal(
    window.document
      .querySelector("#artifacts-section .gha-run-section-toggle")
      .getAttribute("aria-expanded"),
    "false"
  );
  const holder = window.document.createElement("div");
  holder.innerHTML = runSectionsHTML;
  const replacement = holder.querySelector("#annotations-section");
  annotations.replaceWith(replacement);
  await settle();
  assert.equal(
    replacement
      .querySelector(".gha-run-section-toggle")
      .getAttribute("aria-expanded"),
    "true"
  );
  const restored = replacement.cloneNode(true);
  replacement.replaceWith(restored);
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle();
  assert.equal(restored.querySelectorAll(".gha-run-section-toggle").length, 1);
  restored.querySelector(".gha-run-section-toggle").click();
  await settle();
  assert.equal(
    window.getComputedStyle(restored.querySelector("table")).display,
    "none"
  );
  const artifactsToggle = window.document.querySelector(
    "#artifacts-section .gha-run-section-toggle"
  );
  artifactsToggle.click();
  await settle();
  assert.equal(artifactsToggle.getAttribute("aria-expanded"), "true");
  window.history.pushState({}, "", "/owner/repo/actions/runs/124");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle();
  assert.equal(
    restored
      .querySelector(".gha-run-section-toggle")
      .getAttribute("aria-expanded"),
    "false"
  );
  assert.equal(artifactsToggle.getAttribute("aria-expanded"), "false");
});

test("collapsible run sections do not change job details pages", async (t) => {
  const { window } = await setup(t, "/owner/repo/actions/runs/123/job/456");
  window.document.body.insertAdjacentHTML("beforeend", runSectionsHTML);
  await settle();
  assert.equal(window.document.querySelector(".gha-run-section-toggle"), null);
});

test("summary permalinks open their section and still allow manual collapse", async (t) => {
  const { window, graph } = await setup(
    t,
    "/owner/repo/actions/runs/123#job-summary-456"
  );
  graph.insertAdjacentHTML("afterend", runSectionsHTML);
  await settle();
  const summary = window.document.querySelector("job-summary");
  const toggle = window.document.querySelector(
    ".gha-run-summaries > .gha-run-section-header .gha-run-section-toggle"
  );
  const link = summary.querySelector('a[href="#job-summary-456"]');
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(window.scrolledSummary, summary);
  toggle.click();
  await settle();
  await graph.updateJob();
  await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  link.click();
  await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.click();
  await settle();
  window.location.hash = "";
  await settle();
  window.location.hash = "#job-summary-456";
  await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});

test("all summaries share one disclosure without reconnecting a native summary container", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("ok", "completed"));
  const source = window.document.createElement("div");
  source.innerHTML = runSectionsHTML;
  const first = source.querySelector("job-summary");
  const second = first.cloneNode(true);
  second.id = "job-summary-789";
  second.querySelector("h2 a").href = "#job-summary-789";
  const owner = window.document.createElement("div");
  owner.dataset.url = "/owner/repo/actions/runs/123/job_summaries_partial";
  owner.append(first);
  let connects = 0;
  let disconnects = 0;
  window.customElements.define(
    "job-summary",
    class extends window.HTMLElement {
      connectedCallback() {
        connects++;
      }
      disconnectedCallback() {
        disconnects++;
      }
    }
  );
  graph.after(owner);
  const permalink = first.querySelector("h2 a");
  await settle();
  const group = window.document.querySelector(".gha-run-summaries");
  assert.ok(group);
  assert.equal(group, owner);
  assert.equal(group.querySelectorAll("job-summary").length, 1);
  assert.equal(group.querySelectorAll(".gha-run-section-toggle").length, 1);
  assert.equal(
    group.querySelector(".gha-run-summary-count").textContent,
    "1 job summary"
  );
  assert.equal(group.querySelectorAll(".gha-run-summary-count").length, 1);
  assert.equal(connects, 1);
  assert.equal(disconnects, 0);
  owner.append(second);
  await settle();
  assert.equal(group.querySelectorAll("job-summary").length, 2);
  assert.equal(
    group.querySelector(".gha-run-summary-count").textContent,
    "2 job summaries"
  );
  assert.equal(group.querySelectorAll(".gha-run-summary-count").length, 1);
  assert.equal(connects, 2);
  const toggle = group.querySelector(".gha-run-section-toggle");
  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.notEqual(window.getComputedStyle(first).display, "none");
  assert.notEqual(window.getComputedStyle(second).display, "none");
  assert.equal(first.querySelector("h2 a"), permalink);
  const third = second.cloneNode(true);
  third.id = "job-summary-999";
  owner.append(third);
  await settle();
  assert.equal(group.querySelectorAll("job-summary").length, 3);
  assert.equal(group.querySelectorAll(".gha-run-section-toggle").length, 1);
  assert.equal(
    group.querySelector(".gha-run-summary-count").textContent,
    "3 job summaries"
  );
  assert.equal(group.querySelectorAll(".gha-run-summary-count").length, 1);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(connects, 3);
  assert.equal(disconnects, 0);
  const refreshed = first.cloneNode(true);
  const note = window.document.createElement("p");
  note.textContent = "Summary list updated";
  owner.replaceChildren(refreshed, note);
  await settle();
  assert.equal(
    window.document.querySelectorAll(".gha-run-summaries").length,
    1
  );
  assert.equal(owner.querySelectorAll(".gha-run-section-toggle").length, 1);
  assert.equal(
    owner
      .querySelector(".gha-run-section-toggle")
      .getAttribute("aria-expanded"),
    "true"
  );
  assert.equal(
    owner.querySelector(".gha-run-summary-count").textContent,
    "1 job summary"
  );
  assert.equal(owner.querySelectorAll(".gha-run-summary-count").length, 1);
  owner.replaceChildren();
  await settle();
  assert.equal(window.getComputedStyle(owner).display, "none");
  assert.equal(owner.isConnected, true);
});

test("new summary owners stay independent when an existing native owner refreshes", async (t) => {
  for (const dedicated of [false, true]) {
    const { window, graph } = await statusSetup(
      t,
      statusCard("ok", "completed")
    );
    const source = window.document.createElement("div");
    source.innerHTML = runSectionsHTML;
    const first = source.querySelector("job-summary");
    const second = first.cloneNode(true);
    second.id = "job-summary-789";
    const ownerA = window.document.createElement("div");
    ownerA.dataset.url = "/owner/repo/actions/runs/123/summary_a_partial";
    ownerA.append(first);
    if (dedicated) {
      const outer = window.document.createElement("div");
      outer.append(ownerA);
      graph.after(outer);
    } else graph.after(ownerA);
    await settle();
    ownerA.querySelector(".gha-run-section-toggle").click();
    await settle();
    const ownerB = window.document.createElement("div");
    ownerB.dataset.url = "/owner/repo/actions/runs/123/summary_b_partial";
    ownerB.append(second);
    ownerA.after(ownerB);
    await settle();
    assert.equal(ownerA.contains(ownerB), false);
    assert.equal(
      window.document.querySelectorAll(".gha-run-summaries").length,
      1,
      `dedicated host: ${dedicated}`
    );
    const group = window.document.querySelector(".gha-run-summaries");
    assert.ok(group.contains(ownerA) && group.contains(ownerB));
    assert.equal(
      group
        .querySelector(".gha-run-section-toggle")
        .getAttribute("aria-expanded"),
      "true"
    );
    ownerA.replaceChildren(first.cloneNode(true));
    await settle();
    assert.equal(ownerB.isConnected, true);
    assert.equal(group.querySelector("#job-summary-789"), second);
    assert.equal(group.querySelectorAll("job-summary").length, 2);
    assert.equal(group.querySelectorAll(".gha-run-section-toggle").length, 1);
  }
});

test("summary grouping handles separate native wrappers and restored individual disclosures", async (t) => {
  const { window, graph } = await statusSetup(t, statusCard("ok", "completed"));
  const source = window.document.createElement("div");
  source.innerHTML = runSectionsHTML;
  const summaries = [
    source.querySelector("job-summary"),
    source.querySelector("job-summary").cloneNode(true),
  ];
  for (const [index, summary] of summaries.entries()) {
    summary.id += `-${index}`;
    summary.classList.add("gha-run-section");
    summary.setAttribute("data-gha-collapsed", "");
    summary.firstElementChild.classList.add("gha-run-section-header");
    const heading = summary.querySelector("h2");
    heading.classList.add("gha-run-section-heading");
    const oldToggle = window.document.createElement("button");
    oldToggle.className = "gha-run-section-toggle";
    heading.prepend(oldToggle);
    const partial = window.document.createElement("div");
    partial.dataset.url = `/owner/repo/actions/runs/123/summary_${index}_partial`;
    partial.append(summary);
    graph.after(partial);
  }
  await settle();
  const group = window.document.querySelector(".gha-run-summaries");
  assert.ok(group);
  assert.equal(group.querySelectorAll("job-summary").length, 2);
  assert.equal(group.querySelectorAll("[data-url]").length, 2);
  assert.equal(group.querySelectorAll(".gha-run-section-toggle").length, 1);
  assert.equal(group.querySelector("job-summary.gha-run-section"), null);
  const restored = group.cloneNode(true);
  group.replaceWith(restored);
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle();
  assert.equal(
    window.document.querySelectorAll(".gha-run-summaries").length,
    1
  );
  assert.equal(restored.querySelectorAll(".gha-run-section-toggle").length, 1);
});

const pendingMatrixHTML = `<div class="WorkflowCard WorkflowCard-group" id="pending-matrix">
  <div class="WorkflowCard-heading">Matrix: Deploy Agent Config Gateways</div>
  <div class="js-graph-matrix"><div class="MatrixComponent-pending d-flex">
    <svg aria-hidden="true"></svg>Waiting for pending jobs
  </div></div></div>`;

const pendingJobHTML = `<div class="WorkflowCard" id="pending-job">
  <streaming-graph-job class="WorkflowJob">
    <a class="WorkflowJob-title"><svg aria-hidden="true" class="octicon octicon-circle color-fg-muted"></svg><span>Resolve Versioned Apps</span></a>
  </streaming-graph-job></div>`;

function addRunStatus(window, status) {
  const summary = window.document.createElement("div");
  summary.className = "actions-workflow-stats";
  summary.innerHTML = `<div class="d-flex flex-wrap">
    <div><span>Status</span><span class="h4">${status}</span></div>
    <div><span>Total duration</span><span>29m 30s</span></div></div>`;
  window.document.body.prepend(summary);
  return summary.querySelector(".h4");
}

test("Waiting shows regular pending jobs with GitHub's unlabeled circle icon", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    pendingJobHTML + statusCard("running", "active")
  );
  const pending = graph.querySelector("#pending-job");
  statusCheckbox(graph, "waiting").click();
  await settle();
  assert.notEqual(window.getComputedStyle(pending).display, "none");
  assert.equal(
    window.getComputedStyle(graph.querySelector("#running")).display,
    "none"
  );
  statusCheckbox(graph, "waiting").click();
  await settle();
  assert.notEqual(window.getComputedStyle(pending).display, "none");

  addRunStatus(window, "Success");
  statusCheckbox(graph, "skipped").click();
  await settle();
  assert.notEqual(window.getComputedStyle(pending).display, "none");
});

test("finished runs include pending matrices and queued jobs in the Skipped filter", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    pendingMatrixHTML +
      statusCard("queued", "pending") +
      statusCard("completed", "completed") +
      statusCard("running", "active")
  );
  const runStatus = addRunStatus(window, "Success");
  statusCheckbox(graph, "skipped").click();
  for (const status of [
    "Success",
    "Failure",
    "Cancelled",
    "Timed out",
    "Skipped",
  ]) {
    runStatus.textContent = status;
    await settle();
    assert.notEqual(
      window.getComputedStyle(graph.querySelector("#pending-matrix")).display,
      "none",
      status
    );
    assert.notEqual(
      window.getComputedStyle(graph.querySelector("#queued")).display,
      "none",
      status
    );
    assert.equal(
      window.getComputedStyle(graph.querySelector("#completed")).display,
      "none",
      status
    );
    assert.equal(
      window.getComputedStyle(graph.querySelector("#running")).display,
      "none",
      status
    );
  }
  statusCheckbox(graph, "skipped").click();
  await settle();
  assert.notEqual(
    window.getComputedStyle(graph.querySelector("#pending-matrix")).display,
    "none"
  );
});

test("Skipped selection excludes pending jobs while the run is unfinished", async (t) => {
  const { window, graph } = await statusSetup(
    t,
    pendingMatrixHTML + statusCard("completed", "completed")
  );
  statusCheckbox(graph, "skipped").click();
  await settle();
  const pending = graph.querySelector("#pending-matrix");
  assert.equal(
    window.getComputedStyle(pending).display,
    "none",
    "no run status"
  );
  const runStatus = addRunStatus(window, "In progress");
  for (const status of ["In progress", "Queued", "Waiting", "Unknown"]) {
    runStatus.textContent = status;
    await settle();
    assert.equal(window.getComputedStyle(pending).display, "none", status);
  }
});

test("pending filters update when the overall run finishes or its summary is replaced", async (t) => {
  const { window, graph } = await statusSetup(t, pendingMatrixHTML);
  const runStatus = addRunStatus(window, "In progress");
  statusCheckbox(graph, "skipped").click();
  await settle();
  const pending = graph.querySelector("#pending-matrix");
  assert.equal(window.getComputedStyle(pending).display, "none");
  runStatus.firstChild.data = "Success";
  await settle();
  assert.notEqual(window.getComputedStyle(pending).display, "none");
  runStatus.closest(".actions-workflow-stats").remove();
  addRunStatus(window, "In progress");
  await settle();
  assert.equal(window.getComputedStyle(pending).display, "none");
  assert.equal(graph.querySelector("#pending-matrix"), pending);
});
