const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const script = readFileSync(`${__dirname}/../src/js/pr-conversation.js`, "utf8");
const markup = `
  <div class="pull-discussion-timeline"><div class="js-discussion">
    <div class="js-timeline-item" id="description"><div class="js-comment-container"><div class="comment-body">PR description</div></div></div>
    <div class="js-timeline-item" id="person"><div class="timeline-comment"><a class="author" href="/alice">alice</a><div class="comment-body">Please fix this <a href="/apps/ci-bot">bot reference</a></div><button>Show more</button></div></div>
    <div class="js-timeline-item" id="bot"><div class="timeline-comment"><a class="author" href="/apps/ci-bot">ci-bot</a><div class="comment-body">CI result</div></div></div>
    <div class="js-timeline-item discussion-item-deployed" id="deployment">deployed to staging</div>
    <div class="js-timeline-item discussion-item-committed" id="commit">pushed a commit</div>
    <div class="js-timeline-item discussion-item-reviewed" id="review"><div class="comment-body">approved these changes</div></div>
    <div class="js-timeline-item discussion-item-status" id="check">checks passed</div>
    <div class="TimelineItem" id="unresolved"><review-thread-collapsible data-resolved="false"><div class="comment-body">Please update this line</div></review-thread-collapsible></div>
    <div class="TimelineItem" id="resolved"><review-thread-collapsible data-resolved="true"><div class="comment-body">Done</div></review-thread-collapsible></div>
    <div class="js-timeline-item" id="load-more"><button>Load more conversations</button></div>
  </div></div>
  <aside id="partial-discussion-sidebar">
    <div class="discussion-sidebar-item" id="reviewers"><h3>Reviewers</h3></div>
    <div class="discussion-sidebar-item"><h3>Assignees</h3></div>
  </aside>`;

async function setup(t, path = "/owner/repo/pull/123", html = markup, storage = new Map()) {
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
  dom.window.chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries(keys.map((key) => [key, storage.get(key)])),
    set: async (values) => {
      for (const [key, value] of Object.entries(values)) storage.set(key, value);
    },
    remove: async (key) => storage.delete(key),
  } } };
  dom.window.eval(script);
  t.after(() => {
    observers.forEach((observer) => observer.disconnect());
    dom.window.close();
  });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
  return dom.window;
}

const hidden = (window, id) =>
  window.document.getElementById(id).hasAttribute("data-gha-pr-hidden");
const click = (window, label) =>
  [...window.document.querySelectorAll(".gha-pr-filters button")]
    .find((button) => button.textContent.trim() === label).click();

test("places conversation controls above Reviewers and preserves the description", async (t) => {
  const window = await setup(t);
  const controls = window.document.querySelector(".gha-pr-filters");
  assert.ok(controls);
  assert.equal(controls.querySelector(".gha-pr-comment-toggle-all").disabled, true);
  assert.equal(controls.querySelector('input[value="unresolved"]').checked, true);
  assert.equal(controls.nextElementSibling.id, "reviewers");
  click(window, "People");
  assert.equal(hidden(window, "description"), false);
  assert.equal(hidden(window, "person"), false);
  assert.equal(hidden(window, "bot"), true);
  assert.equal(hidden(window, "deployment"), true);
  assert.equal(hidden(window, "commit"), true);
  assert.equal(hidden(window, "review"), true);
  assert.equal(hidden(window, "check"), true);
  assert.equal(hidden(window, "load-more"), false);
  click(window, "All");
  for (const id of ["person", "bot", "deployment", "commit", "review", "check"])
    assert.equal(hidden(window, id), false);
});

test("finds GitHub's plain Reviewers sidebar heading", async (t) => {
  const html = markup.replace(
    '<div class="discussion-sidebar-item" id="reviewers"><h3>Reviewers</h3></div>',
    '<div class="discussion-sidebar-item" id="reviewers" data-channel-event-name="reviewers_updated"><div class="discussion-sidebar-heading">Reviewers</div></div>'
  );
  const window = await setup(t, "/owner/repo/pull/123", html);
  assert.equal(window.document.querySelector(".gha-pr-filters")?.nextElementSibling.id,
    "reviewers");
});

test("places filters at the start of the discussion sidebar without a heading selector", async (t) => {
  const html = markup.replace(
    '<div class="discussion-sidebar-item" id="reviewers"><h3>Reviewers</h3></div>',
    '<div id="reviewers"><div>Reviewers</div></div>'
  );
  const window = await setup(t, "/owner/repo/pull/123", html);
  const sidebar = window.document.querySelector("#partial-discussion-sidebar");
  assert.equal(sidebar.firstElementChild?.className, "gha-pr-filters");
  assert.equal(sidebar.firstElementChild?.nextElementSibling.id, "reviewers");
});

test("quick views and dropdown checkboxes filter loaded timeline entries", async (t) => {
  const window = await setup(t);
  click(window, "Bots");
  assert.equal(hidden(window, "person"), true);
  assert.equal(hidden(window, "bot"), false);
  assert.equal(hidden(window, "load-more"), false);
  click(window, "Comments only");
  assert.equal(hidden(window, "person"), false);
  assert.equal(hidden(window, "bot"), false);
  assert.equal(hidden(window, "deployment"), true);
  const deployment = window.document.querySelector('input[value="deployments"]');
  deployment.checked = true;
  deployment.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(hidden(window, "deployment"), false);
  assert.equal(hidden(window, "commit"), true);
  assert.match(window.document.querySelector(".gha-pr-filter-count").textContent, /5 of 8 loaded/);
});

test("unresolved view keeps only loaded open review threads", async (t) => {
  const window = await setup(t);
  const panel = window.document.querySelector(".gha-pr-filters");
  click(window, "Unresolved");
  assert.equal(hidden(window, "unresolved"), false);
  for (const id of ["person", "bot", "resolved", "deployment", "commit", "review", "check"])
    assert.equal(hidden(window, id), true);
  assert.equal(hidden(window, "description"), false);
  assert.equal(hidden(window, "load-more"), false);
  assert.equal(window.document.querySelector('[data-gha-pr-view="unresolved"]').getAttribute("aria-pressed"), "true");
  assert.equal(panel.querySelector('input[value="unresolved"]').checked, true);
  assert.ok([...panel.querySelectorAll('input[type="checkbox"]')]
    .filter((input) => input.value !== "unresolved").every((input) => !input.checked));
  assert.equal(panel.querySelector(".gha-pr-filter-menu").dataset.active, "true");
  click(window, "All");
  assert.equal(hidden(window, "resolved"), false);
  assert.equal(window.document.querySelector('[data-gha-pr-view="unresolved"]').getAttribute("aria-pressed"), "false");
  assert.equal(panel.querySelector('input[value="unresolved"]').checked, true);
  assert.equal(panel.querySelector(".gha-pr-filter-menu").dataset.active, "false");
});

test("All includes unresolved threads and its checkbox can hide them independently", async (t) => {
  const window = await setup(t);
  const panel = window.document.querySelector(".gha-pr-filters");
  const unresolved = panel.querySelector('input[value="unresolved"]');
  assert.equal(unresolved.checked, true);
  assert.equal(hidden(window, "unresolved"), false);
  unresolved.checked = false;
  unresolved.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(hidden(window, "unresolved"), true);
  assert.equal(hidden(window, "resolved"), false);
  assert.equal(hidden(window, "bot"), false);
  assert.equal(panel.querySelector('[data-gha-pr-view="all"]').getAttribute("aria-pressed"), "false");
  assert.equal(panel.querySelector(".gha-pr-filter-menu").dataset.active, "true");
  click(window, "All");
  assert.equal(unresolved.checked, true);
  assert.equal(hidden(window, "unresolved"), false);
});

test("selecting a dropdown category exits the unresolved view", async (t) => {
  const window = await setup(t);
  const panel = window.document.querySelector(".gha-pr-filters");
  const unresolved = panel.querySelector('input[value="unresolved"]');
  click(window, "Unresolved");
  assert.equal(hidden(window, "unresolved"), false);
  assert.equal(hidden(window, "bot"), true);
  const bots = panel.querySelector('input[value="bots"]');
  bots.checked = true;
  bots.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(unresolved.checked, true);
  assert.equal(bots.checked, true);
  assert.equal(hidden(window, "unresolved"), true);
  assert.equal(hidden(window, "bot"), false);
  assert.equal(panel.querySelector(".gha-pr-filter-menu").dataset.active, "true");
  click(window, "Show all");
  assert.equal(panel.querySelector(".gha-pr-filter-menu").dataset.active, "false");
});

test("updates unresolved view when GitHub marks a thread resolved", async (t) => {
  const window = await setup(t);
  click(window, "Unresolved");
  window.document.querySelector("#unresolved review-thread-collapsible")
    .setAttribute("data-resolved", "true");
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(hidden(window, "unresolved"), true);
  assert.match(window.document.querySelector(".gha-pr-filter-count").textContent, /0 of 8 loaded/);
});

test("shows dotted view links with the activity button on a separate row", async (t) => {
  const window = await setup(t);
  const panel = window.document.querySelector(".gha-pr-filters");
  assert.equal(panel.querySelector(".gha-pr-filter-heading").parentElement.className, "gha-pr-filter-header");
  assert.equal(panel.querySelector(".gha-pr-filter-count").parentElement.className, "gha-pr-filter-header");
  const views = panel.querySelector(".gha-pr-filter-views");
  assert.equal(views.querySelectorAll("[data-gha-pr-view]").length, 5);
  assert.equal(views.querySelectorAll(".gha-pr-filter-separator").length, 4);
  assert.ok([...views.querySelectorAll(".gha-pr-filter-separator")]
    .every((separator) => separator.textContent === "·" && separator.getAttribute("aria-hidden") === "true"));
  assert.equal(panel.querySelector(".gha-pr-filter-menu").previousElementSibling, views);
});

test("keeps conversation filters fixed after the sidebar ends and restores their place above it", async (t) => {
  const window = await setup(t, "/owner/repo/pull/123",
    '<header data-component="SplitPageLayout.Header"><div data-component="PageHeader" class="stickyHeader__example is-stuck__example" id="compact-header"></div></header>' + markup);
  const panel = window.document.querySelector(".gha-pr-filters");
  const compact = window.document.getElementById("compact-header");
  let headerBottom = 60.5;
  compact.getBoundingClientRect = () => ({ bottom: headerBottom });
  const style = window.document.createElement("style");
  style.textContent = readFileSync(`${__dirname}/../src/css/pr-conversation.css`, "utf8");
  window.document.head.append(style);
  let anchorTop = 100;
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === panel || this.classList.contains("gha-pr-filter-placeholder"))
      return { top: anchorTop, left: 800, width: 300, height: 110, right: 1100, bottom: anchorTop + 110 };
    return originalRect.call(this);
  };
  window.dispatchEvent(new window.Event("scroll"));
  assert.notEqual(window.getComputedStyle(panel).position, "fixed");
  anchorTop = -300;
  window.dispatchEvent(new window.Event("scroll"));
  assert.equal(window.getComputedStyle(panel).position, "fixed");
  assert.equal(panel.style.left, "800px");
  assert.equal(panel.style.top, "60px");
  assert.equal(panel.style.width, "300px");
  assert.equal(panel.previousElementSibling?.className, "gha-pr-filter-placeholder");
  headerBottom = 72;
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(panel.style.top, "72px");
  anchorTop = 100;
  window.dispatchEvent(new window.Event("scroll"));
  assert.notEqual(window.getComputedStyle(panel).position, "fixed");
  assert.equal(panel.style.top, "");
  assert.equal(window.document.querySelector(".gha-pr-filter-placeholder"), null);
});

test("collapses one comment to its header and expands its content again", async (t) => {
  const html = `
    <div class="pull-discussion-timeline"><div class="js-discussion">
      <div class="js-timeline-item"><div class="timeline-comment" id="first-card">
        <div><div class="timeline-comment-header">alice commented</div><div class="comment-body" id="first-body">Long comment</div></div>
        <div class="pr-review-reactions d-flex gap-1" id="first-footer">Reactions</div>
      </div></div>
      <div class="js-timeline-item"><div class="timeline-comment" id="second-card">
        <div class="timeline-comment-header">bob commented</div><div class="comment-body" id="second-body">Another comment</div>
      </div></div>
    </div></div>
    <aside id="partial-discussion-sidebar"><div class="discussion-sidebar-item"><h3>Reviewers</h3></div></aside>`;
  const window = await setup(t, "/owner/repo/pull/123", html);
  const style = window.document.createElement("style");
  style.textContent = readFileSync(`${__dirname}/../src/css/pr-conversation.css`, "utf8");
  window.document.head.append(style);
  const first = window.document.querySelector("#first-card .gha-pr-comment-toggle");
  assert.ok(first);
  assert.equal(first.parentElement.firstElementChild, first);
  assert.ok(first.querySelector("svg[aria-hidden='true']"));
  assert.equal(first.getAttribute("aria-label"), "Collapse comment");
  assert.equal(window.document.querySelectorAll(".gha-pr-comment-toggle").length, 2);
  first.click();
  assert.equal(first.getAttribute("aria-expanded"), "false");
  assert.equal(first.getAttribute("aria-label"), "Expand comment");
  assert.equal(window.getComputedStyle(window.document.getElementById("first-body")).display, "none");
  assert.equal(window.document.getElementById("first-footer").hasAttribute("data-gha-pr-comment-hidden"), true);
  assert.equal(window.getComputedStyle(window.document.getElementById("first-footer")).display, "none");
  assert.notEqual(window.getComputedStyle(first.closest(".timeline-comment-header")).display, "none");
  assert.notEqual(window.getComputedStyle(window.document.getElementById("second-body")).display, "none");
  first.click();
  assert.equal(first.getAttribute("aria-expanded"), "true");
  assert.equal(first.getAttribute("aria-label"), "Collapse comment");
  assert.notEqual(window.getComputedStyle(window.document.getElementById("first-body")).display, "none");
  assert.notEqual(window.getComputedStyle(window.document.getElementById("first-footer")).display, "none");
});

test("adds a collapse button to comments loaded later", async (t) => {
  const window = await setup(t);
  window.document.querySelector(".js-discussion").insertAdjacentHTML("beforeend",
    '<div class="js-timeline-item"><div class="timeline-comment"><div class="timeline-comment-header">new comment</div><div class="comment-body">new body</div></div></div>');
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(window.document.querySelectorAll(".gha-pr-comment-toggle").length, 1);
});

test("collapses and expands all loaded comments and saves their states", async (t) => {
  const storage = new Map();
  const html = `
    <div class="pull-discussion-timeline"><div class="js-discussion">
      <div class="js-timeline-item"><div class="timeline-comment" id="issuecomment-1">
        <div class="timeline-comment-header">alice commented</div><div class="comment-body">First</div>
      </div></div>
      <div class="js-timeline-item"><div class="timeline-comment" id="issuecomment-2">
        <div class="timeline-comment-header">bob commented</div><div class="comment-body">Second</div>
      </div></div>
    </div></div>
    <aside id="partial-discussion-sidebar"><div class="discussion-sidebar-item"><h3>Reviewers</h3></div></aside>`;
  const window = await setup(t, "/owner/repo/pull/123", html, storage);
  const all = window.document.querySelector(".gha-pr-comment-toggle-all");
  assert.equal(all.textContent, "Collapse all");
  window.document.querySelector("#issuecomment-1 .gha-pr-comment-toggle").click();
  assert.equal(all.textContent, "Collapse all");
  all.click();
  for (const id of ["issuecomment-1", "issuecomment-2"])
    assert.equal(window.document.getElementById(id).hasAttribute("data-gha-pr-comment-collapsed"), true);
  assert.equal(all.textContent, "Expand all");
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.deepEqual(Array.from(storage.get("ghaPrCollapsedCommentsV1")["/owner/repo/pull/123"]),
    ["issuecomment-1", "issuecomment-2"]);

  window.document.querySelector(".js-discussion").insertAdjacentHTML("beforeend",
    '<div class="js-timeline-item"><div class="timeline-comment" id="issuecomment-3"><div class="timeline-comment-header">new comment</div><div class="comment-body">Third</div></div></div>');
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(all.textContent, "Collapse all");
  all.click();
  for (const id of ["issuecomment-1", "issuecomment-2", "issuecomment-3"])
    assert.equal(window.document.getElementById(id).hasAttribute("data-gha-pr-comment-collapsed"), true);
  all.click();
  for (const id of ["issuecomment-1", "issuecomment-2", "issuecomment-3"])
    assert.equal(window.document.getElementById(id).hasAttribute("data-gha-pr-comment-collapsed"), false);
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  const reloaded = await setup(t, "/owner/repo/pull/123", html, storage);
  assert.equal(reloaded.document.querySelector("#issuecomment-1").hasAttribute("data-gha-pr-comment-collapsed"), false);
});

test("remembers filters when enabled and collapsed comments independently for each PR", async (t) => {
  const storage = new Map();
  const html = `
    <div class="pull-discussion-timeline"><div class="js-discussion">
      <div class="js-timeline-item"><div class="timeline-comment" id="issuecomment-42">
        <div class="timeline-comment-header">alice commented</div><div class="comment-body">Long comment</div>
      </div></div>
    </div></div>
    <aside id="partial-discussion-sidebar"><div class="discussion-sidebar-item"><h3>Reviewers</h3></div></aside>`;
  const first = await setup(t, "/owner/repo/pull/123", html, storage);
  click(first, "Bots");
  first.document.querySelector(".gha-pr-comment-toggle").click();
  await new Promise((resolve) => first.setTimeout(resolve, 0));
  assert.equal(storage.size, 1);
  const remember = first.document.querySelector(".gha-pr-filter-remember input");
  remember.checked = true;
  remember.dispatchEvent(new first.Event("change", { bubbles: true }));
  await new Promise((resolve) => first.setTimeout(resolve, 0));
  assert.equal(storage.size, 2);

  const reloaded = await setup(t, "/owner/repo/pull/123", html, storage);
  assert.equal(reloaded.document.querySelector('[data-gha-pr-view="bots"]').getAttribute("aria-pressed"), "true");
  assert.equal(reloaded.document.querySelector("#issuecomment-42").hasAttribute("data-gha-pr-comment-collapsed"), true);
  assert.equal(reloaded.document.querySelector(".gha-pr-filter-remember input").checked, true);

  const otherPr = await setup(t, "/owner/repo/pull/124", html, storage);
  assert.equal(otherPr.document.querySelector('[data-gha-pr-view="bots"]').getAttribute("aria-pressed"), "true");
  assert.equal(otherPr.document.querySelector("#issuecomment-42").hasAttribute("data-gha-pr-comment-collapsed"), false);
  const otherRemember = otherPr.document.querySelector(".gha-pr-filter-remember input");
  otherRemember.checked = false;
  otherRemember.dispatchEvent(new otherPr.Event("change", { bubbles: true }));
  await new Promise((resolve) => otherPr.setTimeout(resolve, 0));
  assert.equal(storage.size, 1);

  const cleared = await setup(t, "/owner/repo/pull/123", html, storage);
  assert.equal(cleared.document.querySelector('[data-gha-pr-view="all"]').getAttribute("aria-pressed"), "true");
  assert.equal(cleared.document.querySelector("#issuecomment-42").hasAttribute("data-gha-pr-comment-collapsed"), true);
  cleared.document.querySelector(".gha-pr-comment-toggle").click();
  await new Promise((resolve) => cleared.setTimeout(resolve, 0));
  const expanded = await setup(t, "/owner/repo/pull/123", html, storage);
  assert.equal(expanded.document.querySelector("#issuecomment-42").hasAttribute("data-gha-pr-comment-collapsed"), false);
});

test("keeps GitHub's load-more zigzag within the timeline and preserves its button", async (t) => {
  const window = await setup(t);
  window.document.querySelector(".js-discussion").insertAdjacentHTML("beforeend",
    '<div id="js-progressive-timeline-item-container"><form class="ajax-pagination-form pagination-loader-container"><div class="discussion-item-header"><button type="button">Load more...</button></div></form></div>');
  const form = window.document.querySelector("#js-progressive-timeline-item-container form");
  let clicks = 0;
  form.querySelector("button").addEventListener("click", () => clicks++);
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(form.style.width, "");
  assert.equal(form.style.marginLeft, "");
  assert.equal(form.classList.contains("gha-pr-full-width-pagination"), false);
  form.querySelector("button").click();
  assert.equal(clicks, 1);
});

test("keeps native Merge and Code buttons aligned with the compact PR header", async (t) => {
  const html = `
    <header data-component="SplitPageLayout.Header">
      <div data-component="PageHeader"><div data-component="PH_Actions" class="position-relative" id="pr-actions">
        <button id="merge-action">Merge</button><button id="code-action">Code</button>
      </div></div>
      <div data-component="PageHeader" class="stickyHeader__example" id="compact-header">
        <div data-component="TitleArea" style="padding-right: 32px">PR title</div>
      </div>
    </header>
    <div class="pull-discussion-timeline"><div class="js-discussion"></div></div>
    <aside id="partial-discussion-sidebar"><div class="discussion-sidebar-item"><h3>Reviewers</h3></div></aside>`;
  const window = await setup(t, "/owner/repo/pull/123", html);
  const style = window.document.createElement("style");
  style.textContent = ".position-relative { position: relative !important; }\n" +
    readFileSync(`${__dirname}/../src/css/pr-conversation.css`, "utf8");
  window.document.head.append(style);
  const actions = window.document.getElementById("pr-actions");
  const compact = window.document.getElementById("compact-header");
  const normal = actions.closest('[data-component="PageHeader"]');
  const title = compact.querySelector('[data-component="TitleArea"]');
  const visible = (element) => {
    for (let parent = element; parent; parent = parent.parentElement)
      if (window.getComputedStyle(parent).display === "none") return false;
    return true;
  };
  actions.getBoundingClientRect = () => visible(actions)
    ? { width: 160, height: 32 } : { width: 0, height: 0 };
  let titleTop = 64;
  title.getBoundingClientRect = () => ({ x: 200, y: titleTop, right: 1400, width: 1200, height: 48 });
  let clicks = 0;
  let delegatedClicks = 0;
  window.document.querySelector('header[data-component="SplitPageLayout.Header"]')
    .addEventListener("click", () => delegatedClicks++);
  window.document.getElementById("code-action").addEventListener("click", () => clicks++);
  normal.style.display = "none";
  compact.classList.add("is-stuck__example");
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(visible(actions), true);
  assert.equal(window.getComputedStyle(actions).position, "fixed");
  assert.equal(actions.style.getPropertyPriority("position"), "important");
  assert.ok(parseFloat(actions.style.left) >= 0);
  assert.ok(parseFloat(actions.style.left) + 160 <= window.innerWidth);
  assert.equal(actions.style.top, "72px");
  window.document.getElementById("code-action").click();
  assert.equal(clicks, 1);
  assert.equal(delegatedClicks, 1);
  compact.classList.remove("is-stuck__example");
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(normal.contains(actions), true);
  assert.notEqual(window.getComputedStyle(actions).position, "fixed");
  assert.equal(actions.style.getPropertyValue("position"), "");
  assert.equal(actions.style.left, "");
  const replacement = normal.cloneNode(true);
  const replacementActions = replacement.querySelector('[data-component="PH_Actions"]');
  replacementActions.getBoundingClientRect = () => visible(replacementActions)
    ? { width: 160, height: 32 } : { width: 0, height: 0 };
  titleTop = -903;
  compact.classList.add("is-stuck__example");
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(actions.parentElement, compact);
  assert.ok(parseFloat(actions.style.top) >= 0);
  assert.ok(parseFloat(actions.style.top) + 32 <= window.innerHeight);
  normal.replaceWith(replacement);
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(replacementActions.parentElement, compact);
  assert.equal(compact.querySelectorAll('[data-component="PH_Actions"]').length, 1);
  assert.equal(actions.isConnected, false);
});

test("filters new entries, survives sidebar replacement, and clears on navigation", async (t) => {
  const window = await setup(t);
  click(window, "People");
  window.document.querySelector(".js-discussion").insertAdjacentHTML("beforeend",
    '<div class="js-timeline-item" id="new-bot"><div class="timeline-comment"><a class="author" href="/apps/new-bot">new-bot</a><div class="comment-body">Result</div></div></div>');
  window.document.getElementById("reviewers").replaceWith(window.document.getElementById("reviewers").cloneNode(true));
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(hidden(window, "new-bot"), true);
  assert.equal(window.document.querySelectorAll(".gha-pr-filters").length, 1);
  window.history.pushState({}, "", "/owner/repo/pull/123/changes");
  window.dispatchEvent(new window.PopStateEvent("popstate"));
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  assert.equal(window.document.querySelector(".gha-pr-filters"), null);
  assert.equal(hidden(window, "bot"), false);
});
