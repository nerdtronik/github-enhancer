/**
 * Run-list page: card layout, the "Needs attention" panel and its settings menu. Everything is
 * driven by createPageScheduler at the bottom of the file.
 */
import { createPageScheduler } from "../../core/scheduler";
import { createIcon, settings as prefs, store } from "../../core/settings";
import { actionsRepository, route, workflowRoute } from "../../core/routes";
import { ui } from "../../core/ui";
import { durationSeconds, formatDuration, median, runState, statusTone } from "./runState";

declare const location: { pathname: string };

const runListSelector =
  'section[aria-label^="Workflow runs"] [data-listview-component="items-list"]';
const isEnabled = () => prefs.get("runList_enabled");
const isEnhancedView = () => prefs.get("runList_enhancedViewEnabled");
let settingsLoaded = false;
let cardsReady = false;
let cardsScheduled = false;
// Generation counter: bumped when the user toggles the panel; async work started under an older
// value drops its result, so a stale fetch cannot repaint after the setting changed.
let settingGeneration = 0;
const checkedRuns = new Map<
  string,
  { median: number | null; start: number | null; checkedAt: number }
>();
const pendingRuns = new Set<string>();
const linkedLists = new WeakSet<Element>();
const historyCaches = new Map<
  string,
  Promise<Record<string, { fetchedAt: number; samples: number[] }>>
>();
const historyPages = new Map<
  string,
  { fetchedAt: number; promise: Promise<any> }
>();
// Concurrency limit: at most two history page fetches run at once; the rest queue.
let activeHistoryRequests = 0;
const waitingHistoryRequests: Array<() => void> = [];

function repository(): string {
  const current = route();
  return current.kind === "actions" && current.rest === ""
    ? actionsRepository(current)
    : "";
}

function runListRepository(): string {
  const current = route();
  if (current.kind !== "actions") return "";
  const listing =
    current.rest === "" ||
    (current.rest.startsWith("/workflows/") && current.rest.length > 11);
  return listing ? actionsRepository(current) : "";
}

// We rely on the run list page embedding its data as JSON in a react-app.embeddedData script,
// under a route key ("allWorkflowRunsRoute" on All workflows, "workflowRunsRoute" for a single
// workflow). It carries fields the DOM lacks (workflow file path, conclusion, timing). Any parse
// failure returns [] and callers fall back to the DOM label.
function embeddedRuns(doc: Document, route: string): any[] {
  const script = doc.querySelector(
    'script[data-target="react-app.embeddedData"]',
  );
  try {
    const runs = JSON.parse(script?.textContent ?? "")?.payload?.[route]
      ?.workflowRuns;
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

function clearCards(): void {
  document
    .querySelectorAll(".gha-run-card-pending")
    .forEach((list) => list.classList.remove("gha-run-card-pending"));
  for (const old of document.querySelectorAll(".gha-run-card-list")) {
    old
      .querySelectorAll(".gha-run-card-status")
      .forEach((pill) => pill.remove());
    for (const element of old.querySelectorAll('[class*="gha-run-card"]'))
      for (const name of [...element.classList])
        if (name.startsWith("gha-run-card")) element.classList.remove(name);
    old.classList.remove("gha-run-card-list");
  }
}

function followCardLink(event: Event): void {
  if (event.defaultPrevented) return;
  const target = event.target as Element;
  const row = target.closest?.(".gha-run-card") as HTMLElement | null;
  if (!row || row.parentElement !== event.currentTarget) return;
  if (event.type === "click") {
    const mouse = event as unknown as MouseEvent;
    if (
      !ui.isPlainClick(mouse) ||
      target.closest(
        'a, button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="menuitem"], [contenteditable]',
      )
    )
      return;
  } else if (event.type === "keydown") {
    const key = event as unknown as KeyboardEvent;
    if (key.key !== "Enter" || event.target !== row) return;
  }
  const link = row.querySelector(
    ':scope > [data-listview-item-title-container] a[href*="/actions/runs/"]',
  ) as HTMLAnchorElement | null;
  if (!link) return;
  if (event.type === "keydown") {
    event.preventDefault();
    event.stopPropagation();
  }
  link.click();
}

function enableCardsWhenIdle(): void {
  if (cardsScheduled) return;
  cardsScheduled = true;
  const activate = () => {
    cardsScheduled = false;
    if (cardsReady) return;
    cardsReady = true;
    renderCards();
  };
  const schedule = () => {
    if (cardsReady) return;
    if (window.requestIdleCallback) window.requestIdleCallback(activate);
    else setTimeout(activate, 0);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

function renderCards(): void {
  const repo = runListRepository();
  const list = document.querySelector(runListSelector);
  if (!isEnhancedView() || !repo || !list) {
    clearCards();
    return;
  }
  if (!cardsReady) {
    // Pending hides the native list until idle activation, so it does not flash before the
    // cards apply.
    list.classList.add("gha-run-card-pending");
    enableCardsWhenIdle();
    return;
  }
  list.classList.add("gha-run-card-list");
  if (!linkedLists.has(list)) {
    list.addEventListener("click", followCardLink);
    list.addEventListener("keydown", followCardLink, true);
    linkedLists.add(list);
  }
  const route = repository() ? "allWorkflowRunsRoute" : "workflowRunsRoute";
  const byId = new Map(
    embeddedRuns(document, route).map((run) => [String(run.id), run]),
  );
  const prefix = `/${repo}/actions/runs/`;
  for (const row of list.querySelectorAll(":scope > li")) {
    const link = row.querySelector(
      'a[href*="/actions/runs/"]',
    ) as HTMLAnchorElement;
    const id = link?.pathname.startsWith(prefix)
      ? link.pathname.slice(prefix.length)
      : "";
    if (!/^\d+$/.test(id)) continue;
    const title = row.querySelector(
      ":scope > [data-listview-item-title-container]",
    );
    if (!title) continue;
    const fullTitle = link?.textContent.trim();
    if (link?.title !== fullTitle) link.title = fullTitle;
    const state = runState(row.getAttribute("aria-label") ?? "", byId.get(id));
    row.classList.add("gha-run-card");
    title.classList.add("gha-run-card-title");
    const icon = title.nextElementSibling;
    if (icon?.querySelector("svg") && !icon.querySelector("a, button"))
      icon.classList.add("gha-run-card-icon");
    // We rely on prefixes of GitHub's React class names (MainContent__, MetadataContainer__, ...),
    // never the full names; the gha-run-card-* classes added here are what run-list.css styles.
    row
      .querySelector(':scope > [class*="MainContent__"]')
      ?.classList.add("gha-run-card-details");
    const metadata = row.querySelector(
      ':scope > [class*="MetadataContainer__"]',
    );
    metadata?.classList.add("gha-run-card-metadata");
    metadata
      ?.querySelector('[class*="BranchMetadata__"]')
      ?.classList.add("gha-run-card-branch");
    metadata
      ?.querySelector('[class*="TimingMetadata__"]')
      ?.classList.add("gha-run-card-timing");
    row
      .querySelector(':scope > [class*="ActionBar__"]')
      ?.classList.add("gha-run-card-actions");
    let pill = title.querySelector<HTMLElement>(
      ":scope > .gha-run-card-status",
    );
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "gha-run-card-status";
      title.append(pill);
    }
    if (pill.textContent !== state.label) pill.textContent = state.label;
    const tone = statusTone(state.label);
    if (pill.dataset.tone !== tone) pill.dataset.tone = tone;
  }
  list.classList.remove("gha-run-card-pending");
}

function currentRuns(
  repo: string,
  list: HTMLUListElement,
): {
  id: string;
  url: string;
  title: string;
  branch: string;
  workflowPath: string;
  active: boolean;
  status: string;
  detail: string;
}[] {
  const embedded = embeddedRuns(document, "allWorkflowRunsRoute");
  const byId = new Map(embedded.map((run) => [String(run.id), run]));
  const rows: {
    id: string;
    url: string;
    title: string;
    branch: string;
    workflowPath: string;
    active: boolean;
    status: string;
    detail: string;
  }[] = [];
  const prefix = `/${repo}/actions/runs/`;
  for (const row of list.querySelectorAll(":scope > li")) {
    const link = row.querySelector(
      'a[href*="/actions/runs/"]',
    ) as HTMLAnchorElement;
    const id = link?.pathname.startsWith(prefix)
      ? link.pathname.slice(prefix.length)
      : "";
    if (!/^\d+$/.test(id)) continue;
    const data = byId.get(id);
    const nativeStatus = row.getAttribute("aria-label") ?? "";
    const state = runState(nativeStatus, data);
    const branch =
      row.querySelector('a[href*="/tree/"]')?.textContent.trim() ||
      (typeof data?.headBranch === "string" ? data.headBranch : "");
    rows.push({
      id,
      url: link.href,
      title: link.textContent.trim(),
      branch,
      workflowPath: data?.workflowFilePath ?? "",
      active: state.active,
      status: state.attention,
      detail: "",
    });
  }
  return rows;
}

// Fetches one page of a workflow's runs and returns its embedded runs, or null on failure or
// when the setting, page or generation changed while queued. Results are cached for 10 minutes;
// null results are evicted so the next call retries.
function fetchHistoryPage(
  repo: string,
  route: string,
  page: number,
  generation: number,
): Promise<any> {
  const key = JSON.stringify([repo, route, page]);
  const cached = historyPages.get(key);
  if (cached && cached.fetchedAt > Date.now() - 600000) return cached.promise;
  const promise = (async () => {
    await new Promise<void>((resolve) => {
      if (activeHistoryRequests < 2) {
        activeHistoryRequests++;
        resolve();
      } else waitingHistoryRequests.push(resolve);
    });
    try {
      if (!isEnabled() || settingGeneration !== generation || repository() !== repo)
        return null;
      const response = await fetch(
        `/${repo}/actions/workflows/${route}?page=${page}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) return null;
      const doc = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      return embeddedRuns(doc, "workflowRunsRoute");
    } finally {
      const next = waitingHistoryRequests.shift();
      if (next) next();
      else activeHistoryRequests--;
    }
  })();
  historyPages.set(key, { fetchedAt: Date.now(), promise });
  promise
    .then(
      (runs) => {
        if (runs === null && historyPages.get(key)?.promise === promise)
          historyPages.delete(key);
      },
      () => {
        if (historyPages.get(key)?.promise === promise)
          historyPages.delete(key);
      },
    )
    .catch(() => {});
  return promise;
}

// Returns the durations of the 5 most recent successful runs of the same workflow file and title,
// or null if fewer than 5 are found within 2 pages. Runs already on the page count first.
async function readHistory(
  repo: string,
  run: { workflowPath: string; title: string; id: string },
  loaded: any[],
  generation: number,
): Promise<number[] | null> {
  const samples = new Map<string, { seconds: number; createdAt: number }>();
  const add = (item: any) => {
    if (
      item.workflowFilePath !== run.workflowPath ||
      item.title?.trim() !== run.title ||
      item.state?.conclusion !== "WORKFLOW_RUN_CONCLUSION_SUCCESS" ||
      item.timing?.kind !== "WORKFLOW_RUN_TIMING_KIND_DURATION"
    )
      return;
    const seconds = durationSeconds(item.timing.text);
    if (seconds === null) return;
    samples.set(String(item.id), {
      seconds,
      createdAt: Date.parse(item.createdAt?.timestamp) || 0,
    });
  };
  loaded.forEach(add);
  const route = workflowRoute(run.workflowPath);
  if (!route) return null;
  for (let page = 1; samples.size < 5 && page <= 2; page++) {
    if (!isEnabled() || settingGeneration !== generation || repository() !== repo)
      return null;
    const history = await fetchHistoryPage(repo, route, page, generation);
    if (!history) return null;
    if (!history.length) break;
    history.forEach(add);
  }
  if (samples.size < 5) return null;
  return [...samples.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)
    .map((sample) => sample.seconds);
}

// Median duration for a run's workflow + title, cached per repo in storage for 10 minutes.
async function cachedMedian(
  repo: string,
  run: { id: string; url: string; workflowPath: string; title: string },
  loaded: any[],
  generation: number,
): Promise<number | null> {
  if (!historyCaches.has(repo))
    historyCaches.set(
      repo,
      store
        .read<Record<string, any>>("runHistory", repo)
        .then((stored) => stored ?? {})
        .catch(() => ({})),
    );
  const cache = await historyCaches.get(repo)!;
  const identity = JSON.stringify([run.workflowPath, run.title]);
  const saved = cache[identity];
  if (
    saved?.fetchedAt > Date.now() - 600000 &&
    Array.isArray(saved.samples) &&
    saved.samples.length === 5
  )
    return median(saved.samples);
  const samples = await readHistory(repo, run, loaded, generation);
  if (!samples) return null;
  cache[identity] = { fetchedAt: Date.now(), samples };
  store
    .write("runHistory", repo, cache)
    .catch((error) => console.warn("Could not cache run history", error));
  return median(samples);
}

// Scrapes the run page HTML for the start time (earliest elapsed timer of an unconcluded job);
// null if absent or in the future.
async function readRunningStart(run: { url: string }): Promise<number | null> {
  const response = await fetch(run.url, { credentials: "same-origin" });
  if (!response.ok) return null;
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const starts = [
    ...doc.querySelectorAll(
      'streaming-graph-job[data-concluded="false"] relative-time[format="elapsed"][datetime]',
    ),
  ]
    .map((time) => Date.parse(time.getAttribute("datetime") ?? ""))
    .filter(Number.isFinite);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  return start <= Date.now() ? start : null;
}

// Starts (once per 30s per run) the median + start lookup for an active run; the panel reads
// the outcome from checkedRuns on a later update. Stale generations discard their result.
function inspectRunning(
  repo: string,
  run: { id: string; workflowPath: string },
  loaded: any[],
): void {
  const key = `${repo}:${run.id}`;
  const checked = checkedRuns.get(key);
  if (checked && Date.now() - checked.checkedAt >= 30000)
    checkedRuns.delete(key);
  if (pendingRuns.has(key) || checkedRuns.has(key) || !run.workflowPath) return;
  pendingRuns.add(key);
  const generation = settingGeneration;
  cachedMedian(
    repo,
    run as { id: string; url: string; workflowPath: string; title: string },
    loaded,
    generation,
  )
    .then(async (median) => ({
      median,
      start:
        median === null ||
        !isEnabled() ||
        generation !== settingGeneration ||
        repository() !== repo
          ? null
          : await readRunningStart(run as any),
    }))
    .then(({ median, start }) => {
      if (generation !== settingGeneration) return;
      checkedRuns.set(key, { median, start, checkedAt: Date.now() });
      if (isEnabled() && repository() === repo) scheduleUpdate();
    })
    .catch(() => {
      if (generation === settingGeneration)
        checkedRuns.set(key, {
          median: null,
          start: null,
          checkedAt: Date.now(),
        });
    })
    .finally(() => {
      pendingRuns.delete(key);
      if (generation !== settingGeneration && isEnabled() && repository() === repo)
        scheduleUpdate();
    });
}

function settings(filters: HTMLElement, allWorkflows: boolean): void {
  let menu = document.querySelector<HTMLDetailsElement>(
    ".gha-run-attention-settings",
  );
  if (!menu) {
    menu = document.createElement("details");
    menu.className = "gha-run-attention-settings";
    const trigger = document.createElement("summary");
    trigger.setAttribute("aria-label", "Run list settings");
    trigger.title = "Run list settings";
    trigger.append(createIcon("gear"));
    const popup = document.createElement("div");
    popup.className = "gha-run-attention-settings-menu";
    const attention = ui.toggle({
      label: "Show Needs attention",
      labelId: "gha-run-attention-setting-label",
      pressed: isEnabled(),
      variant: "knob",
      rowClass: "gha-run-settings-row gha-run-attention-setting-row",
      buttonClass: "gha-run-attention-toggle",
      onChange: () => {
        settingGeneration++;
        checkedRuns.clear();
        historyPages.clear();
        attention.sync(!isEnabled());
        void prefs.set("runList_enabled", !isEnabled());
        update();
      },
    });
    const attentionRow = attention.row;
    const view = ui.toggle({
      label: "Enhanced view",
      labelId: "gha-run-list-view-setting-label",
      pressed: isEnhancedView(),
      variant: "knob",
      buttonClass: "gha-run-list-view-toggle",
      onChange: () => {
        const next = !isEnhancedView();
        // A click means the page is long loaded, so skip the idle gate.
        if (next) cardsReady = true;
        view.sync(next);
        void prefs.set("runList_enhancedViewEnabled", next);
        update();
      },
    });
    const viewRow = view.row;
    popup.append(attentionRow, viewRow);
    menu.append(trigger, popup);
  }
  ui.detailsMenu(menu);
  menu.querySelector<HTMLElement>(".gha-run-attention-setting-row")!.hidden =
    !allWorkflows;
  if (menu.parentElement !== filters || menu !== filters.lastElementChild)
    filters.append(menu);
}

function update(): void {
  if (!settingsLoaded) {
    // Whether cards apply is unknown until settings load; keep the list hidden meanwhile so it
    // does not flash in its native layout first.
    if (runListRepository())
      document
        .querySelector(runListSelector)
        ?.classList.add("gha-run-card-pending");
    return;
  }
  renderCards();
  const repo = repository();
  const runRepo = runListRepository();
  const list = document.querySelector<HTMLUListElement>(runListSelector);
  // The filter bar is located structurally: the first div of the list's previous sibling.
  const filters =
    list?.previousElementSibling?.querySelector<HTMLElement>(":scope > div");
  if (!runRepo || !filters) {
    document.querySelector(".gha-run-attention")?.remove();
    document.querySelector(".gha-run-attention-settings")?.remove();
    return;
  }
  settings(filters, !!repo);
  if (!repo) {
    document.querySelector(".gha-run-attention")?.remove();
    return;
  }
  const heading = document.querySelector(
    'h1[data-component="PH_Title"]',
  ) as HTMLElement | null;
  const search = document.querySelector(
    'search[aria-label="Filter workflow runs"]',
  ) as HTMLElement | null;
  const section = list?.closest(
    'section[aria-label="Workflow runs"]',
  ) as HTMLElement | null;
  // Besides the route we require the exact "All workflows" heading, the search box and the
  // section, so the panel is only inserted once the page has rendered.
  if (
    !repo ||
    !heading ||
    heading.textContent.trim() !== "All workflows" ||
    !search ||
    !section
  ) {
    document.querySelector(".gha-run-attention")?.remove();
    return;
  }
  let panel = document.querySelector(
    ".gha-run-attention",
  ) as HTMLElement | null;
  if (!isEnabled()) {
    panel?.remove();
    return;
  }
  if (panel?.nextElementSibling !== section) {
    panel?.remove();
    panel = document.createElement("section");
    panel.className = "gha-run-attention";
    panel.setAttribute("aria-label", "Needs attention");
    section.before(panel);
  }
  panel!.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = "Needs attention";
  const scope = document.createElement("span");
  scope.textContent = "Current list";
  const header = document.createElement("div");
  header.className = "gha-run-attention-header";
  header.append(title, scope);
  panel.append(header);
  const current = currentRuns(repo, list!);
  for (const run of current)
    if (run.active)
      inspectRunning(repo, run, embeddedRuns(document, "allWorkflowRunsRoute"));
  const attention = current.filter((run) => run.status);
  for (const run of current) {
    const checked = checkedRuns.get(`${repo}:${run.id}`);
    if (
      !run.active ||
      checked?.median === null ||
      checked?.start === null ||
      checked === undefined
    )
      continue;
    const elapsed = Math.floor((Date.now() - checked.start) / 1000);
    // Slow only if beyond twice the usual duration and also more than 5 minutes over it.
    if (elapsed <= 2 * checked.median || elapsed <= checked.median + 300)
      continue;
    attention.push({
      ...run,
      status: "Slower than usual",
      detail: `Running at least ${formatDuration(elapsed)} · usually ${formatDuration(checked.median)}`,
    });
  }
  if (!attention.length) {
    const empty = document.createElement("p");
    empty.textContent = "No runs need attention in the current list.";
    panel.append(empty);
    return;
  }
  const items = document.createElement("ul");
  for (const run of attention) {
    const item = document.createElement("li");
    const status = document.createElement("strong");
    status.textContent = run.status;
    const link = document.createElement("a");
    link.href = run.url;
    link.textContent = run.title;
    item.append(status, link);
    if (run.branch) {
      const branch = document.createElement("span");
      branch.className = "gha-run-attention-branch";
      branch.textContent = run.branch;
      branch.title = run.branch;
      item.append(branch);
    }
    if (run.detail) {
      const detail = document.createElement("span");
      detail.textContent = run.detail;
      item.append(detail);
    }
    items.append(item);
  }
  panel.append(items);
}

const relevant =
  'section[aria-label^="Workflow runs"], [data-component="PageHeader"], search[aria-label="Filter workflow runs"]';
const scheduler = createPageScheduler({
  update,
  active: () =>
    Boolean(runListRepository()) ||
    Boolean(
      document.querySelector(
        ".gha-run-attention, .gha-run-attention-settings, .gha-run-card-list",
      ),
    ),
  // Mutations inside our own panels are ignored (we rewrite them every update and would loop),
  // but their removal counts so the panel is re-added if the page re-renders without it.
  relevant: (records) => {
    if (
      !runListRepository() &&
      !document.querySelector(
        ".gha-run-attention, .gha-run-attention-settings, .gha-run-card-list",
      )
    )
      return false;
    return records.some(({ target, addedNodes, removedNodes }) => {
      const el = target as Element;
      if (el.closest?.(".gha-run-attention, .gha-run-attention-settings"))
        return false;
      if (el.closest?.(relevant)) return true;
      if (
        [...removedNodes].some(
          (node) =>
            node.nodeType === 1 &&
            (node as Element).matches?.(
              ".gha-run-attention, .gha-run-attention-settings",
            ),
        )
      )
        return true;
      return [...addedNodes, ...removedNodes].some(
        (node) =>
          node.nodeType === 1 &&
          ((node as Element).matches?.(relevant) ||
            (node as Element).querySelector?.(relevant)),
      );
    });
  },
  observe: {
    target: document.body,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label"],
    subtree: true,
  },
  events: ["turbo:load", "popstate"],
});
scheduler.start();
const scheduleUpdate = scheduler.schedule;
// Hide the native list right away; update() applies or clears the cards once settings load.
if (runListRepository())
  document
    .querySelector(runListSelector)
    ?.classList.add("gha-run-card-pending");
scheduleUpdate();
prefs.ready.finally(() => {
  settingsLoaded = true;
  scheduleUpdate();
});
