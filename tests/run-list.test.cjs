const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const scriptPath = `${__dirname}/../run-list.js`;
const script = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
const settle = (window) => new Promise((resolve) => window.setTimeout(resolve, 50));

function run(id, title, conclusion, status = "WORKFLOW_RUN_STATUS_COMPLETED") {
  return {
    id: String(id), title, workflowFilePath: ".github/workflows/test.yml",
    runUrl: `https://github.com/owner/repo/actions/runs/${id}`,
    state: { status, conclusion },
    timing: { kind: status === "WORKFLOW_RUN_STATUS_IN_PROGRESS" ?
      "WORKFLOW_RUN_TIMING_KIND_IN_PROGRESS" : "WORKFLOW_RUN_TIMING_KIND_DURATION",
      text: status === "WORKFLOW_RUN_STATUS_IN_PROGRESS" ? "In progress" : "1m" },
  };
}

function historyPage(runs) {
  return `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
    payload: { workflowRunsRoute: { workflowRuns: runs } },
  })}</script>`;
}

function detailPage(start) {
  return `<streaming-graph-job data-concluded="false"><relative-time format="elapsed" datetime="${start}"></relative-time></streaming-graph-job>`;
}

function page(runs) {
  const rows = runs.map((item) => `<li aria-label="${item.nativeStatus || item.state.conclusion || "currently running:"}">
    <div data-listview-item-title-container="true"><h3><a href="${item.runUrl}">${item.title}</a></h3></div>
    ${item.nativeBranch ? `<a href="/owner/repo/tree/${item.nativeBranch}">${item.nativeBranch}</a>` : ""}
  </li>`).join("");
  return `<main><div data-component="PageHeader"><h1 data-component="PH_Title">All workflows</h1></div>
    <search aria-label="Filter workflow runs"><input placeholder="Search runs"></search>
    <section aria-label="Workflow runs"><div aria-label="Workflow runs results"><div>
      <div><h2 class="sr-only">Runs</h2><div><h3>Workflow runs</h3><button>Auto-refresh: 30s</button>
        <div class="run-filters"><button>Workflow</button><button>Event</button></div></div>
        <ul data-listview-component="items-list">${rows}</ul></div>
    </div></div></section>
  </main><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
    payload: { allWorkflowRunsRoute: { workflowRuns: runs } },
  })}</script>`;
}

async function setup(t, runs, options = {}) {
  const dom = new JSDOM(options.html || page(runs), {
    url: `https://github.com${options.path || "/owner/repo/actions"}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const observers = [];
  window.MutationObserver = class extends window.MutationObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  const data = { ...(options.storage || {}) };
  window.chrome = { storage: { local: {
    async get(key) { return options.get ? options.get(key) : { [key]: data[key] }; },
    async set(items) { Object.assign(data, items); },
  } } };
  window.fetch = options.fetch || (() => { throw new Error("Unexpected fetch"); });
  if (options.now) window.Date.now = () => Date.parse(options.now);
  window.requestIdleCallback = (callback) => callback();
  options.beforeEval?.(window);
  window.eval(script);
  t.after(() => {
    observers.forEach((observer) => observer.disconnect());
    window.close();
  });
  await settle(window);
  return { window, data };
}

test("shows native run controls as a wrapping toolbar above the card grid", async (t) => {
  const item = run(1, "Build", "WORKFLOW_RUN_CONCLUSION_SUCCESS");
  const html = `<main><div data-component="PageHeader"><h1 data-component="PH_Title">All workflows</h1></div>
    <search aria-label="Filter workflow runs"><input placeholder="Search runs"></search>
    <section aria-label="Workflow runs"><div aria-label="Workflow runs results"><div class="Container__didvJM">
      <div class="container__uZQXyV"><h2 class="sr-only">Runs</h2>
        <div class="container__FLA0EF Metadata__CBFjuU"><h3>2500+ workflow runs</h3>
          <button type="button">Auto-refresh: 30s</button>
          <div class="container__T-3mZN"><button class="ListFilterButton__ccIaF1">Workflow</button>
            <button class="ListFilterButton__ccIaF1">Event</button></div>
        </div>
        <ul data-listview-component="items-list"><li aria-label="completed successfully: Build">
          <div data-listview-item-title-container="true"><h4><a href="${item.runUrl}">Build</a></h4></div>
        </li></ul>
      </div></div></div></section></main>`;
  const { window } = await setup(t, [item], { html, beforeEval(window) {
    const style = window.document.createElement("style");
    style.textContent = `.Metadata__CBFjuU { display: grid; background: #20242a; border-bottom: 1px solid #3d444d; }
      .container__T-3mZN { display: block; }
      .ListFilterButton__ccIaF1 { border: 0; }` +
      readFileSync(`${__dirname}/../run-list.css`, "utf8");
    window.document.head.append(style);
  } });
  const toolbar = window.document.querySelector(".Metadata__CBFjuU");
  const filters = toolbar.lastElementChild;
  assert.ok(window.document.querySelector(".gha-run-card-list"));
  assert.equal(window.getComputedStyle(toolbar).display, "flex");
  assert.equal(window.getComputedStyle(toolbar).flexWrap, "wrap");
  assert.equal(window.getComputedStyle(toolbar).backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(window.getComputedStyle(toolbar).borderBottomWidth, "0px");
  assert.equal(window.getComputedStyle(toolbar).paddingLeft, "12px");
  assert.equal(window.getComputedStyle(filters).display, "flex");
  assert.equal(window.getComputedStyle(filters).flexWrap, "wrap");
  assert.equal(window.getComputedStyle(filters).marginLeft, "auto");
  assert.equal(window.getComputedStyle(filters.firstElementChild).borderTopStyle, "solid");
});

test("keeps native run links and actions when presenting cards on both run lists", async (t) => {
  const item = run(1, "npm_and_yarn in /lambdas/services/utdExpertClinicianNotificationWorker and /lambdas/services/fabWorkspaceDataAggregator - Update #1640030170", "WORKFLOW_RUN_CONCLUSION_SUCCESS");
  const html = `<main><div data-component="PageHeader"><h1 data-component="PH_Title">All workflows</h1></div>
    <search aria-label="Filter workflow runs"><input placeholder="Search runs"></search>
    <section aria-label="Workflow runs"><ul data-listview-component="items-list"><li tabindex="0" aria-label="completed successfully: ${item.title}">
      <div data-listview-item-title-container="true"><h4><a href="${item.runUrl}">${item.title}</a></h4><span class="trailingBadgesContainer__4AEjpg"></span></div>
      <div class="container__Woawlr"><svg aria-hidden="true"></svg></div>
      <div class="MainContent__zoDzfF"><div><div><strong>test</strong><span>#1</span><span>Pull request</span><a href="/pull/1">#1</a><span>synchronize by</span><a href="/actor">actor</a></div></div></div>
      <div class="MetadataContainer__jj1WBp"><div class="BranchMetadata__CQYAZQ"><a href="/owner/repo/tree/main">main</a></div>
        <div class="TimingMetadata__df2TP6"><span><svg aria-hidden="true"></svg><relative-time datetime="2026-10-20T10:00:00Z">now</relative-time></span>
        <button type="button" style="display:flex"><span class="prc-Button-ButtonContent-Iohp5"><span><svg aria-hidden="true"></svg></span><span>1m</span></span></button></div></div>
      <div class="ActionBar__jBtcyJ"><button aria-haspopup="menu">More</button></div>
    </li></ul></section></main><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: { allWorkflowRunsRoute: { workflowRuns: [item] }, workflowRunsRoute: { workflowRuns: [item] } },
    })}</script>`;
  for (const path of ["/owner/repo/actions", "/owner/repo/actions/workflows/test.yml"]) {
    let originalLink;
    let originalMenu;
    const routeHtml = path.endsWith("test.yml") ?
      html.replace('section aria-label="Workflow runs"', 'section aria-label="Workflow runs for test"') : html;
    const { window } = await setup(t, [item], { path, html: routeHtml, beforeEval(window) {
      const style = window.document.createElement("style");
      style.textContent = ".prc-Button-ButtonContent-Iohp5 { display: grid; justify-content: center; } .ActionBar__jBtcyJ { padding-right: 16px; }" +
        readFileSync(`${__dirname}/../run-list.css`, "utf8");
      window.document.head.append(style);
      originalLink = window.document.querySelector(`a[href="${item.runUrl}"]`);
      originalMenu = window.document.querySelector('button[aria-haspopup="menu"]');
    } });
    const row = window.document.querySelector('[data-listview-component="items-list"] > li');
    const link = row.querySelector(`a[href="${item.runUrl}"]`);
    const menu = row.querySelector('button[aria-haspopup="menu"]');
    assert.ok(row.classList.contains("gha-run-card"), path);
    assert.equal(row.querySelector(".gha-run-card-status")?.textContent, "Completed");
    assert.equal(row.querySelector('a[href*="/tree/"]')?.textContent, "main");
    assert.equal(row.querySelectorAll(".gha-run-card-status").length, 1);
    assert.equal(link, originalLink);
    assert.equal(link.title, item.title);
    assert.equal(menu, originalMenu);
    const by = [...row.querySelectorAll(".gha-run-card-details span")]
      .find((span) => span.textContent === "synchronize by");
    assert.equal(by?.nextElementSibling?.getAttribute("href"), "/actor");
    assert.notEqual(window.getComputedStyle(by).marginLeft, "auto");
    assert.notEqual(window.getComputedStyle(by.parentElement).flexWrap, "nowrap");
    assert.equal(row.querySelector(".gha-run-card-timing")?.querySelectorAll("svg").length, 2);
    assert.equal(window.getComputedStyle(row).display, "grid");
    assert.equal(window.getComputedStyle(row).columnGap, "0");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-icon")).display, "none");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-timing")).display, "flex");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-timing")).justifySelf, "start");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-timing")).justifyContent, "flex-start");
    assert.equal(window.getComputedStyle(row.querySelector("h4")).getPropertyValue("-webkit-line-clamp"), "2");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-details")).alignSelf, "end");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-branch")).gridRow, "2");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-details")).gridRow, "3");
    const [date, duration] = row.querySelector(".gha-run-card-timing").children;
    assert.equal(window.getComputedStyle(duration).order, "1");
    assert.equal(window.getComputedStyle(duration).justifyContent, "flex-start");
    assert.equal(window.getComputedStyle(duration.firstElementChild).justifyContent, "start");
    assert.equal(window.getComputedStyle(date).order, "2");
    assert.equal(window.getComputedStyle(row.querySelector(".gha-run-card-actions")).paddingRight, "0px");
    assert.equal(window.getComputedStyle(row).cursor, "pointer");
    let runClicks = 0;
    link.addEventListener("click", (event) => { event.preventDefault(); runClicks++; });
    const branch = row.querySelector('a[href*="/tree/"]');
    branch.addEventListener("click", (event) => event.preventDefault());
    row.querySelector(".gha-run-card-details strong").click();
    row.querySelector(".gha-run-card-status").click();
    assert.equal(runClicks, 2, path);
    branch.click();
    row.querySelector(".gha-run-card-timing button").click();
    menu.click();
    assert.equal(runClicks, 2, path);
    row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(runClicks, 3, path);
    menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(runClicks, 3, path);
    const replacement = new window.DOMParser().parseFromString(routeHtml, "text/html")
      .querySelector('[data-listview-component="items-list"]');
    row.parentElement.replaceWith(replacement);
    await settle(window);
    assert.ok(replacement.classList.contains("gha-run-card-list"));
    assert.equal(replacement.querySelector(".gha-run-card-status")?.textContent, "Completed");
    window.history.pushState({}, "", "/owner/repo");
    window.document.dispatchEvent(new window.Event("turbo:load"));
    await settle(window);
    assert.equal(replacement.querySelector("li")?.classList.contains("gha-run-card"), false);
    assert.equal(replacement.querySelector(".gha-run-card-status"), null);
  }
});

test("uses live status for card pills and updates them without duplication", async (t) => {
  const runs = [
    { ...run(1, "Queued build", "WORKFLOW_RUN_CONCLUSION_SUCCESS"), nativeStatus: "queued: Run 1" },
    { ...run(2, "Running build", "WORKFLOW_RUN_CONCLUSION_SUCCESS"), nativeStatus: "currently running: Run 2" },
    { ...run(3, "Failed build", "WORKFLOW_RUN_CONCLUSION_SUCCESS"), nativeStatus: "failed: Run 3" },
    { ...run(4, "Approval needed", "WORKFLOW_RUN_CONCLUSION_SUCCESS"), nativeStatus: "requires action: Run 4" },
  ];
  const { window } = await setup(t, runs);
  const rows = [...window.document.querySelectorAll(".gha-run-card-list > li")];
  assert.deepEqual(rows.map((row) => row.querySelector(".gha-run-card-status")?.textContent),
    ["Queued", "Running", "Failed", "Action required"]);
  assert.deepEqual(rows.map((row) => row.querySelector(".gha-run-card-status")?.dataset.tone),
    ["queued", "accent", "danger", "attention"]);
  const style = window.document.createElement("style");
  style.textContent = readFileSync(`${__dirname}/../run-list.css`, "utf8");
  window.document.head.append(style);
  for (const row of rows) {
    const pillStyle = window.getComputedStyle(row.querySelector(".gha-run-card-status"));
    assert.equal(pillStyle.fontSize, "13px");
    assert.equal(pillStyle.fontWeight, "500");
    assert.equal(pillStyle.padding, "2px 8px");
  }
  rows[1].setAttribute("aria-label", "completed successfully: Run 2");
  await settle(window);
  assert.equal(rows[1].querySelector(".gha-run-card-status")?.textContent, "Completed");
  assert.equal(rows[1].querySelectorAll(".gha-run-card-status").length, 1);
});

test("shows current failed, timed-out, and action-required runs without changing GitHub rows", async (t) => {
  const runs = [
    run(1, "Failed build", "WORKFLOW_RUN_CONCLUSION_FAILURE"),
    run(2, "Timed out build", "WORKFLOW_RUN_CONCLUSION_TIMED_OUT"),
    run(3, "Approval needed", "WORKFLOW_RUN_CONCLUSION_ACTION_REQUIRED"),
    run(4, "Successful build", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    run(5, "Cancelled build", "WORKFLOW_RUN_CONCLUSION_CANCELLED"),
  ];
  const { window } = await setup(t, runs);
  const panel = window.document.querySelector(".gha-run-attention");
  assert.ok(panel);
  assert.match(panel.textContent, /Needs attention/);
  assert.match(panel.textContent, /current list/i);
  assert.deepEqual(
    [...panel.querySelectorAll('a[href*="/actions/runs/"]')].map((a) => a.pathname),
    runs.slice(0, 3).map((item) => new URL(item.runUrl).pathname)
  );
  assert.equal(window.document.querySelectorAll('[data-listview-component="items-list"] > li').length, 5);
});

test("activates after navigating from Code to All workflows without reloading", async (t) => {
  const { window } = await setup(t, [run(1, "Failed build",
    "WORKFLOW_RUN_CONCLUSION_FAILURE")], { path: "/owner/repo" });
  assert.equal(window.document.querySelector(".gha-run-attention"), null);
  window.history.pushState({}, "", "/owner/repo/actions");
  window.document.dispatchEvent(new window.Event("turbo:load"));
  await settle(window);
  assert.ok(window.document.querySelector(".gha-run-attention"));
});

test("shows each attention run's branch beside its title when available", async (t) => {
  const main = { ...run(1, "Failed build", "WORKFLOW_RUN_CONCLUSION_FAILURE"), headBranch: "main" };
  const release = { ...run(2, "Approval needed", "WORKFLOW_RUN_CONCLUSION_ACTION_REQUIRED"),
    nativeBranch: "release/v1" };
  const { window } = await setup(t, [main, release,
    run(3, "Timed out build", "WORKFLOW_RUN_CONCLUSION_TIMED_OUT")]);
  const items = [...window.document.querySelectorAll(".gha-run-attention li")];
  assert.deepEqual(items.map((item) => item.querySelector(".gha-run-attention-branch")?.textContent),
    ["main", "release/v1", undefined]);
  assert.equal(items[0].querySelector('a[href*="/actions/runs/"]').nextElementSibling,
    items[0].querySelector(".gha-run-attention-branch"));
});

test("the saved setting hides the panel but leaves an accessible gear to restore it", async (t) => {
  const { window, data } = await setup(t, [run(1, "Failed build", "WORKFLOW_RUN_CONCLUSION_FAILURE")], {
    storage: { ghaRunAttentionSettingsV1: { enabled: false } },
  });
  const gear = window.document.querySelector('.gha-run-attention-settings > summary');
  assert.equal(gear?.getAttribute("aria-label"), "Run list settings");
  assert.equal(gear.parentElement.parentElement.className, "run-filters");
  assert.equal(gear.parentElement.parentElement.lastElementChild, gear.parentElement);
  assert.equal(gear.querySelector('svg[aria-hidden="true"]')?.getAttribute("viewBox"), "0 0 16 16");
  assert.equal(window.document.querySelector(".gha-run-attention"), null);
  assert.ok(window.document.querySelector(".gha-run-card-list > .gha-run-card"));
  const toggle = window.document.querySelector(".gha-run-attention-toggle");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  const css = window.document.createElement("style");
  css.textContent = readFileSync(`${__dirname}/../run-list.css`, "utf8");
  window.document.head.append(css);
  assert.equal(window.getComputedStyle(window.document.querySelector('search[aria-label="Filter workflow runs"]')).width, "100%");
  assert.equal(window.getComputedStyle(toggle.parentElement).justifyContent, "space-between");
  assert.equal(window.getComputedStyle(toggle).marginLeft, "auto");
  assert.equal(window.getComputedStyle(window.document.querySelector(".gha-run-list-view-toggle")).marginLeft, "auto");
  toggle.click();
  await settle(window);
  assert.equal(data.ghaRunAttentionSettingsV1.enabled, true);
  assert.ok(window.document.querySelector(".gha-run-attention"));
  gear.parentElement.open = true;
  gear.parentElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(gear.parentElement.open, false);
  gear.parentElement.open = true;
  window.document.body.click();
  assert.equal(gear.parentElement.open, false);
});

test("switches between cards and native lists on both run-list routes", async (t) => {
  for (const path of ["/owner/repo/actions", "/owner/repo/actions/workflows/test.yml"]) {
    const { window, data } = await setup(t, [run(1, "Build", "WORKFLOW_RUN_CONCLUSION_SUCCESS")], { path });
    const gear = window.document.querySelector(".gha-run-attention-settings");
    const toggle = gear?.querySelector(".gha-run-list-view-toggle");
    const original = window.document.querySelector('a[href*="/actions/runs/"]');
    assert.equal(gear?.parentElement?.lastElementChild, gear, path);
    assert.equal(toggle?.getAttribute("aria-pressed"), "true", path);
    assert.equal(gear.querySelector(".gha-run-attention-setting-row")?.hidden,
      path !== "/owner/repo/actions");
    toggle.click();
    await settle(window);
    assert.equal(data.ghaRunAttentionSettingsV1.enhancedViewEnabled, false, path);
    assert.equal(data.ghaRunAttentionSettingsV1.enabled, true, path);
    assert.equal(window.document.querySelector(".gha-run-card-list"), null, path);
    assert.equal(window.document.querySelector(".gha-run-card-status"), null, path);
    assert.equal(window.document.querySelector('a[href*="/actions/runs/"]'), original, path);
    let runClicks = 0;
    original.addEventListener("click", (event) => { event.preventDefault(); runClicks++; });
    original.closest("li").click();
    assert.equal(runClicks, 0, path);
    assert.equal(!!window.document.querySelector(".gha-run-attention"), path === "/owner/repo/actions");
    toggle.click();
    await settle(window);
    assert.equal(data.ghaRunAttentionSettingsV1.enhancedViewEnabled, true, path);
    assert.ok(window.document.querySelector(".gha-run-card-list > .gha-run-card"), path);
    original.closest("li").click();
    assert.equal(runClicks, 1, path);
  }
  const { window } = await setup(t, [run(2, "Saved native view", "WORKFLOW_RUN_CONCLUSION_SUCCESS")], {
    storage: { ghaRunAttentionSettingsV1: { enabled: true, enhancedViewEnabled: false } },
  });
  assert.equal(window.document.querySelector(".gha-run-card-list"), null);
  assert.equal(window.document.querySelector(".gha-run-list-view-toggle")?.getAttribute("aria-pressed"), "false");
});

test("defers saved cards until idle but enables them immediately from settings", async (t) => {
  for (const path of ["/owner/repo/actions", "/owner/repo/actions/workflows/test.yml"]) {
    const idleCallbacks = [];
    const { window } = await setup(t, [run(1, "Build", "WORKFLOW_RUN_CONCLUSION_SUCCESS")], {
      path,
      beforeEval(page) {
        const style = page.document.createElement("style");
        style.textContent = readFileSync(`${__dirname}/../run-list.css`, "utf8");
        page.document.head.append(style);
        page.requestIdleCallback = (callback) => { idleCallbacks.push(callback); };
      },
    });
    const toggle = window.document.querySelector(".gha-run-list-view-toggle");
    const list = window.document.querySelector('[data-listview-component="items-list"]');
    assert.ok(toggle, path);
    assert.equal(window.document.querySelector(".gha-run-card-list"), null, path);
    assert.equal(window.getComputedStyle(list).display, "none", path);
    assert.equal(idleCallbacks.length, 1, path);
    idleCallbacks[0]();
    await settle(window);
    assert.ok(window.document.querySelector(".gha-run-card-list > .gha-run-card"), path);
    assert.equal(window.getComputedStyle(list).display, "grid", path);
  }

  const idleCallbacks = [];
  const { window } = await setup(t, [run(2, "Manual", "WORKFLOW_RUN_CONCLUSION_SUCCESS")], {
    beforeEval(page) {
      const style = page.document.createElement("style");
      style.textContent = readFileSync(`${__dirname}/../run-list.css`, "utf8");
      page.document.head.append(style);
      page.requestIdleCallback = (callback) => { idleCallbacks.push(callback); };
    },
  });
  const toggle = window.document.querySelector(".gha-run-list-view-toggle");
  const list = window.document.querySelector('[data-listview-component="items-list"]');
  assert.equal(window.getComputedStyle(list).display, "none");
  toggle.click();
  assert.notEqual(window.getComputedStyle(list).display, "none");
  toggle.click();
  const card = window.document.querySelector(".gha-run-card-list > .gha-run-card");
  assert.ok(card);
  assert.equal(window.getComputedStyle(list).display, "grid");
  idleCallbacks[0]();
  assert.equal(window.document.querySelector(".gha-run-card-list > .gha-run-card"), card);
});

test("keeps the saved default run list visible while enhanced cards are deferred", async (t) => {
  const { window } = await setup(t, [run(1, "Native", "WORKFLOW_RUN_CONCLUSION_SUCCESS")], {
    storage: { ghaRunAttentionSettingsV1: { enabled: true, enhancedViewEnabled: false } },
    beforeEval(page) {
      const style = page.document.createElement("style");
      style.textContent = readFileSync(`${__dirname}/../run-list.css`, "utf8");
      page.document.head.append(style);
      page.requestIdleCallback = () => {};
    },
  });
  const list = window.document.querySelector('[data-listview-component="items-list"]');
  assert.notEqual(window.getComputedStyle(list).display, "none");
});

test("reveals a saved default list as soon as its setting loads", async (t) => {
  let resolveSettings;
  const { window } = await setup(t, [run(1, "Native", "WORKFLOW_RUN_CONCLUSION_SUCCESS")], {
    get: () => new Promise((resolve) => { resolveSettings = resolve; }),
    beforeEval(page) {
      const style = page.document.createElement("style");
      style.textContent = readFileSync(`${__dirname}/../run-list.css`, "utf8");
      page.document.head.append(style);
    },
  });
  const list = window.document.querySelector('[data-listview-component="items-list"]');
  assert.equal(window.getComputedStyle(list).display, "none");
  resolveSettings({ ghaRunAttentionSettingsV1: { enhancedViewEnabled: false } });
  await settle(window);
  assert.notEqual(window.getComputedStyle(list).display, "none");
});

test("follows GitHub list replacements without duplicating controls and leaves other routes", async (t) => {
  const { window } = await setup(t, [run(1, "Failed build", "WORKFLOW_RUN_CONCLUSION_FAILURE")]);
  const list = window.document.querySelector('[data-listview-component="items-list"]');
  const replacement = list.cloneNode(true);
  replacement.querySelector("a").textContent = "New failure";
  list.replaceWith(replacement);
  await settle(window);
  assert.equal(window.document.querySelectorAll(".gha-run-attention").length, 1);
  assert.match(window.document.querySelector(".gha-run-attention").textContent, /New failure/);
  window.history.pushState({}, "", "/owner/repo/actions/workflows/test.yml");
  replacement.remove();
  await settle(window);
  assert.equal(window.document.querySelector(".gha-run-attention"), null);
  assert.equal(window.document.querySelector(".gha-run-attention-settings"), null);
});

test("keeps the settings gear at the end of a replaced filter group", async (t) => {
  const { window } = await setup(t, [run(1, "Failed build", "WORKFLOW_RUN_CONCLUSION_FAILURE")]);
  const filters = window.document.querySelector(".run-filters");
  filters.replaceWith(filters.cloneNode(true));
  await settle(window);
  const gear = window.document.querySelector(".gha-run-attention-settings");
  assert.equal(window.document.querySelectorAll(".gha-run-attention-settings").length, 1);
  assert.equal(gear.parentElement, window.document.querySelector(".run-filters"));
  assert.equal(gear.parentElement.lastElementChild, gear);
});

test("restores the panel and gear if GitHub removes extension siblings", async (t) => {
  const { window } = await setup(t, [run(1, "Failed build", "WORKFLOW_RUN_CONCLUSION_FAILURE")]);
  window.document.querySelector(".gha-run-attention").remove();
  window.document.querySelector(".gha-run-attention-settings").remove();
  await settle(window);
  assert.equal(window.document.querySelectorAll(".gha-run-attention").length, 1);
  assert.equal(window.document.querySelectorAll(".gha-run-attention-settings").length, 1);
  assert.match(window.document.querySelector(".gha-run-attention").textContent, /Failed build/);
});

test("flags an active run only from five comparable successes and an active-job start", async (t) => {
  const active = { ...run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS"),
    headBranch: "dev" };
  const successes = [1, 2, 3, 4, 5].map((id) => ({
    ...run(id, "Canary (dev)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  const other = [6, 7, 8, 10, 11].map((id) => ({
    ...run(id, "Canary (prd)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "1h" },
  }));
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes("/workflows/") ?
      historyPage([...other, ...successes]) : detailPage("2026-10-20T09:48:00Z");
    return { ok: true, text: async () => body };
  };
  const { window } = await setup(t, [active], { fetch, now: "2026-10-20T10:00:00Z" });
  await settle(window);
  const panel = window.document.querySelector(".gha-run-attention");
  assert.match(panel.textContent, /Slower than usual/);
  assert.equal(panel.querySelector(".gha-run-attention-branch")?.textContent, "dev");
  assert.match(panel.textContent, /Running at least 12m/);
  assert.match(panel.textContent, /usually 2m/);
  assert.ok(calls.some((url) => url.includes("/actions/workflows/test.yml")));
  assert.ok(calls.some((url) => url.includes("/actions/runs/9")));
});

test("requires five samples and a duration strictly beyond the slow threshold", async (t) => {
  const now = "2026-10-20T10:00:00Z";
  const successes = [1, 2, 3, 4, 5].map((id) => ({
    ...run(id, "Canary (dev)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  for (const [count, seconds, slow] of [[4, 1200, false], [5, 420, false], [5, 421, true]]) {
    const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
    const start = new Date(Date.parse(now) - seconds * 1000).toISOString();
    const fetch = async (url) => ({ ok: true, text: async () =>
      String(url).includes("/workflows/") ? historyPage(successes.slice(0, count)) : detailPage(start) });
    const { window } = await setup(t, [active], { fetch, now });
    await settle(window);
    assert.equal(/Slower than usual/.test(window.document.querySelector(".gha-run-attention").textContent), slow);
  }
});

test("uses current native status after a run finishes, even when embedded data is stale", async (t) => {
  const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  const successes = [1, 2, 3, 4, 5].map((id) => ({
    ...run(id, "Canary (dev)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  const fetch = async (url) => ({ ok: true, text: async () =>
    String(url).includes("/workflows/") ? historyPage(successes) : detailPage("2026-10-20T09:40:00Z") });
  const { window } = await setup(t, [active], { fetch, now: "2026-10-20T10:00:00Z" });
  await settle(window);
  assert.match(window.document.querySelector(".gha-run-attention").textContent, /Slower than usual/);
  const row = window.document.querySelector('[data-listview-component="items-list"] > li');
  const completed = row.cloneNode(true);
  completed.setAttribute("aria-label", "completed successfully: Run 9");
  row.replaceWith(completed);
  await settle(window);
  assert.doesNotMatch(window.document.querySelector(".gha-run-attention").textContent, /Slower than usual/);
});

test("stores sampled history for ten minutes and does not request it again after a reload", async (t) => {
  const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  const successes = [1, 2, 3, 4, 5].map((id) => ({
    ...run(id, "Canary (dev)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, text: async () =>
      String(url).includes("/workflows/") ? historyPage(successes) : detailPage("2026-10-20T09:40:00Z") };
  };
  const first = await setup(t, [active], { fetch, now: "2026-10-20T10:00:00Z" });
  await settle(first.window);
  assert.ok(first.data["ghaRunAttentionHistoryV1:owner/repo"]);
  const historyCalls = calls.filter((url) => url.includes("/workflows/")).length;
  const second = await setup(t, [active], { fetch, now: "2026-10-20T10:01:00Z", storage: first.data });
  await settle(second.window);
  assert.match(second.window.document.querySelector(".gha-run-attention").textContent, /Slower than usual/);
  assert.equal(calls.filter((url) => url.includes("/workflows/")).length, historyCalls);
});

test("limits concurrent workflow-history requests to two", async (t) => {
  const active = [1, 2, 3].map((id) => ({
    ...run(id, `Workflow ${id}`, undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS"),
    workflowFilePath: `.github/workflows/workflow-${id}.yml`,
  }));
  let inFlight = 0;
  let peak = 0;
  const fetch = async (url) => {
    if (String(url).includes("/workflows/")) {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return { ok: true, text: async () => historyPage([]) };
    }
    return { ok: true, text: async () => detailPage("2026-10-20T09:40:00Z") };
  };
  const { window } = await setup(t, active, { fetch, now: "2026-10-20T10:00:00Z" });
  await settle(window);
  assert.equal(peak, 2);
});

test("refreshes a running timer instead of leaving an old elapsed value in the panel", async (t) => {
  const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  const successes = [1, 2, 3, 4, 5].map((id) => ({
    ...run(id, "Canary (dev)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  const fetch = async (url) => ({ ok: true, text: async () =>
    String(url).includes("/workflows/") ? historyPage(successes) : detailPage("2026-10-20T09:40:00Z") });
  const { window } = await setup(t, [active], { fetch, now: "2026-10-20T10:00:00Z" });
  await settle(window);
  assert.match(window.document.querySelector(".gha-run-attention").textContent, /Running at least 20m/);
  window.Date.now = () => Date.parse("2026-10-20T10:02:00Z");
  const row = window.document.querySelector('[data-listview-component="items-list"] > li');
  row.replaceWith(row.cloneNode(true));
  await settle(window);
  assert.match(window.document.querySelector(".gha-run-attention").textContent, /Running at least 22m/);
});

test("ignores unrelated page mutations instead of rebuilding the attention panel", async (t) => {
  const { window } = await setup(t, [run(1, "Failed build", "WORKFLOW_RUN_CONCLUSION_FAILURE")]);
  const panel = window.document.querySelector(".gha-run-attention");
  const header = panel.firstElementChild;
  window.document.body.append(window.document.createElement("div"));
  await settle(window);
  assert.equal(panel.firstElementChild, header);
});

test("waits for a saved off setting before making any run-history request", async (t) => {
  let release;
  const calls = [];
  const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  const { window } = await setup(t, [active], {
    get: () => new Promise((resolve) => { release = resolve; }),
    fetch: async (url) => { calls.push(String(url)); throw new Error("Unexpected request"); },
  });
  assert.deepEqual(calls, []);
  release({ ghaRunAttentionSettingsV1: { enabled: false } });
  await settle(window);
  assert.equal(window.document.querySelector(".gha-run-attention"), null);
  assert.ok(window.document.querySelector(".gha-run-attention-settings"));
  assert.deepEqual(calls, []);
});

test("fetches no more than two history pages and accepts five samples across them", async (t) => {
  const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  const successes = [1, 2, 3, 4, 5].map((id) => ({
    ...run(id, "Canary (dev)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  const calls = [];
  const fetch = async (url) => {
    if (String(url).includes("/workflows/")) {
      calls.push(String(url));
      return { ok: true, text: async () => historyPage(calls.length === 1 ? successes.slice(0, 3) : successes.slice(3)) };
    }
    return { ok: true, text: async () => detailPage("2026-10-20T09:40:00Z") };
  };
  const { window } = await setup(t, [active], { fetch, now: "2026-10-20T10:00:00Z" });
  await settle(window);
  assert.match(window.document.querySelector(".gha-run-attention").textContent, /Slower than usual/);
  assert.deepEqual(calls.map((url) => new URL(url, "https://github.com").search), ["?page=1", "?page=2"]);
});

test("does not treat another repository's run as belonging to a dotted repository name", async (t) => {
  const wrong = { ...run(1, "Wrong repository", "WORKFLOW_RUN_CONCLUSION_FAILURE"),
    runUrl: "https://github.com/owner/repoXwithXdot/actions/runs/1" };
  const { window } = await setup(t, [wrong], { path: "/owner/repo.with.dot/actions" });
  assert.doesNotMatch(window.document.querySelector(".gha-run-attention").textContent, /Wrong repository/);
});

test("matches comparison titles after trimming whitespace without counting queue age", async (t) => {
  const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  active.createdAt = { timestamp: "2026-10-20T08:00:00Z" };
  const successes = [1, 2, 3, 4, 5].map((id) => ({
    ...run(id, " Canary (dev) ", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  const fetch = async (url) => ({ ok: true, text: async () =>
    String(url).includes("/workflows/") ? historyPage(successes) : detailPage("2026-10-20T09:48:00Z") });
  const { window } = await setup(t, [active], { fetch, now: "2026-10-20T10:00:00Z" });
  await settle(window);
  assert.match(window.document.querySelector(".gha-run-attention").textContent, /Running at least 12m/);
});

test("turning the panel off stops a second history page after the first response", async (t) => {
  const active = run(9, "Canary (dev)", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  const partial = [1, 2].map((id) => ({
    ...run(id, "Canary (dev)", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    timing: { kind: "WORKFLOW_RUN_TIMING_KIND_DURATION", text: "2m" },
  }));
  let release;
  const historyCalls = [];
  const fetch = async (url) => {
    if (String(url).includes("/workflows/")) {
      historyCalls.push(String(url));
      if (historyCalls.length === 1) await new Promise((resolve) => { release = resolve; });
      return { ok: true, text: async () => historyPage(partial) };
    }
    return { ok: true, text: async () => detailPage("2026-10-20T09:40:00Z") };
  };
  const { window } = await setup(t, [active], { fetch, now: "2026-10-20T10:00:00Z" });
  assert.equal(historyCalls.length, 1);
  window.document.querySelector(".gha-run-attention-toggle").click();
  release();
  await settle(window);
  assert.equal(historyCalls.length, 1);
  assert.equal(window.document.querySelector(".gha-run-attention"), null);
});

test("does not fetch run details when there are too few comparable successes", async (t) => {
  const active = run(9, "Unique title", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, text: async () => historyPage([]) };
  };
  const { window } = await setup(t, [active], { fetch });
  await settle(window);
  assert.ok(calls.some((url) => url.includes("/workflows/")));
  assert.equal(calls.some((url) => url.includes("/actions/runs/9")), false);
});

test("does not start queued history requests after the panel is disabled", async (t) => {
  const active = [1, 2, 3].map((id) => ({
    ...run(id, `Workflow ${id}`, undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS"),
    workflowFilePath: `.github/workflows/workflow-${id}.yml`,
  }));
  const calls = [];
  const releases = [];
  const { window } = await setup(t, active, { fetch: async (url) => {
    calls.push(String(url));
    await new Promise((resolve) => releases.push(resolve));
    return { ok: true, text: async () => historyPage([]) };
  } });
  assert.equal(calls.length, 2);
  window.document.querySelector(".gha-run-attention-toggle").click();
  releases.splice(0).forEach((release) => release());
  await settle(window);
  assert.equal(calls.length, 2);
});

test("shares the two history pages across concurrent runs of one workflow", async (t) => {
  const active = [1, 2, 3].map((id) =>
    run(id, "Same title", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS"));
  const calls = [];
  const { window } = await setup(t, active, { fetch: async (url) => {
    calls.push(String(url));
    return { ok: true, text: async () => historyPage([
      run(99, "Other title", "WORKFLOW_RUN_CONCLUSION_SUCCESS"),
    ]) };
  } });
  await settle(window);
  assert.equal(calls.length, 2);
});

test("a failed history request can be retried after the next refresh", async (t) => {
  const active = run(9, "Canary", undefined, "WORKFLOW_RUN_STATUS_IN_PROGRESS");
  let calls = 0;
  const { window } = await setup(t, [active], {
    now: "2026-10-20T10:00:00Z",
    fetch: async () => { calls++; throw new Error("Network failure"); },
  });
  assert.equal(calls, 1);
  window.Date.now = () => Date.parse("2026-10-20T10:01:00Z");
  const row = window.document.querySelector('[data-listview-component="items-list"] > li');
  row.replaceWith(row.cloneNode(true));
  await settle(window);
  assert.equal(calls, 2);
});
