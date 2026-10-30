/**
 * Workflow filter for the Actions sidebar: injects a filter box, lists workflows missing from the
 * native (paginated) sidebar from a fetched index, and hands the list to the categories view.
 */
import { createPageScheduler } from "../../core/scheduler";
import { store } from "../../core/settings";
import { actionsRepository, route, workflowRoute } from "../../core/routes";
import * as categories from "../workflow-categories/view";

interface WorkflowItem {
  id: number | string;
  name: string;
  path: string;
  state?: string;
}

interface WorkflowIndex {
  workflows: WorkflowItem[];
  uses: number;
}

interface WorkflowState {
  sidebar: HTMLElement;
  running: boolean;
  expanding: boolean;
  fetching: boolean;
  index?: WorkflowItem[];
  showIndex?: (() => void) | null;
  loadingTimeout?: ReturnType<typeof setTimeout>;
  apiList?: HTMLUListElement;
  apiRows?: Map<string, HTMLElement>;
  fontSignature?: string;
  fontRevision?: number;
}

type ScrollPath = Array<
  [Element, Element | null, string | null, string | null, string | null]
>;

// Polling interval for the "Show more" loop and for waiting on a running expansion: there is no
// completion event, so we re-check on a short timer.
const CLICK_DELAY_MS = 50;
// Quiet period after the last click before the loading text hides (see extendLoadingTimeout).
const LOADING_TIMEOUT_MS = 500;
// Upper bound for loading native rows just to click a pin; plain expansion has no deadline.
const PIN_LOADING_TIMEOUT_MS = 15000;
// A cached index is reused this many times before refetching, so new/removed workflows show up.
const CACHED_WORKFLOW_RELOADS = 3;
const PIN_SELECTOR =
  '[data-component="ActionList.TrailingAction"][class*="pinButton"] button, button[aria-label*="pin" i]';
const WORKFLOW_LINKS = 'a[href*="/actions/workflows/"]';

// GitHub navigates in place (Turbo): `repository` tracks which repository the injected UI belongs
// to and `query` survives sidebar re-renders.
let repository = "";
let query = "";
let fontRevision = 0;
const loadingSidebars = new WeakMap<Element, WorkflowState>();
const cleanupTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
const workflowIndexLoads = new Map<string, Promise<WorkflowItem[]>>();
let scrollContainers = new WeakMap<
  Element,
  { container: Element; path: ScrollPath }
>();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isActionsPath = () => actionsRepository(route()) === repository;

// Fetches every page of the Actions workflow list. The page size is taken from page 1 and the
// page count from totalCount; the result is validated as complete so a partial list is never
// cached or shown (it would hide workflows).
async function fetchWorkflowIndex(
  currentRepository: string,
): Promise<WorkflowItem[]> {
  async function page(number: number) {
    const response = await fetch(
      `/${currentRepository}/actions/_workflows?page=${number}&sort=default`,
      {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const route = (await response.json())?.payload?.workflowsSidebarRoute;
    if (!Array.isArray(route?.workflows) || !Number.isInteger(route.totalCount))
      throw new Error("Unexpected workflow response");
    return route as { workflows: WorkflowItem[]; totalCount: number };
  }

  const first = await page(1);
  const pageSize = first.workflows.length;
  if (first.totalCount && !pageSize)
    throw new Error("Incomplete workflow response");
  const workflows = [...first.workflows];
  for (
    let number = 2;
    number <= Math.ceil(first.totalCount / pageSize);
    number++
  ) {
    const next = await page(number);
    workflows.push(...next.workflows);
  }
  if (
    workflows.length !== first.totalCount ||
    new Set(workflows.map((item) => item.id)).size !== workflows.length ||
    workflows.some(
      (item) => typeof item.name !== "string" || !workflowRoute(item.path),
    )
  )
    throw new Error("Incomplete workflow response");
  return workflows;
}

// Cache record is {workflows, uses}. Each cached use bumps `uses`; once it reaches
// CACHED_WORKFLOW_RELOADS the next load refetches, since nothing else invalidates the cache.
// Concurrent callers share one promise per repository; failures are dropped so a retry can refetch.
// Storage errors only warn: the cache is an optimization.
function loadWorkflowIndex(
  currentRepository: string,
): Promise<WorkflowItem[]> {
  const existing = workflowIndexLoads.get(currentRepository);
  if (existing) return existing;
  const loading = (async () => {
    let cached: WorkflowIndex | undefined;
    try {
      cached = await store.read<WorkflowIndex>(
        "workflowIndex",
        currentRepository,
      );
    } catch (error) {
      console.warn("Could not read cached workflow list", error);
    }
    if (
      cached &&
      Array.isArray(cached.workflows) &&
      Number.isInteger(cached.uses) &&
      cached.uses >= 0 &&
      cached.uses < CACHED_WORKFLOW_RELOADS
    ) {
      try {
        await store.write("workflowIndex", currentRepository, {
          ...cached,
          uses: cached.uses + 1,
        });
      } catch (error) {
        console.warn("Could not update cached workflow list", error);
      }
      return cached.workflows;
    }
    const workflows = await fetchWorkflowIndex(currentRepository);
    try {
      await store.write("workflowIndex", currentRepository, {
        workflows,
        uses: 0,
      });
    } catch (error) {
      console.warn("Could not cache workflow list", error);
    }
    return workflows;
  })();
  workflowIndexLoads.set(currentRepository, loading);
  loading.catch(() => workflowIndexLoads.delete(currentRepository));
  return loading;
}

function whenPageIdle(callback: () => void): void {
  const schedule = () => {
    if (window.requestIdleCallback) window.requestIdleCallback(callback);
    else setTimeout(callback, 0);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

function buttonLabel(button: Element): string {
  return (
    button.getAttribute("aria-label") ??
    document
      .getElementById(button.getAttribute("aria-labelledby") as string)
      ?.textContent?.trim() ??
    ""
  );
}

// The native sidebar only renders the first pages of workflows. Workflows known from the fetched
// index but absent from it get our own rows (after the sidebar); once a native row exists for an
// id, ours is removed. Re-run on every update because GitHub re-renders and navigates in place, so
// aria-current is refreshed on every run; the native pin icon is cloned only when a row is
// created. Returns our row links.
function syncFetchedRows(
  state: WorkflowState,
  controls: HTMLElement,
  sidebar: HTMLElement,
  nativeWorkflows: HTMLAnchorElement[],
): HTMLAnchorElement[] {
  if (!state.index) return [];
  if (!state.apiList) {
    state.apiList = document.createElement("ul");
    state.apiList.className = "gha-workflow-api-list";
    state.apiRows = new Map();
  }
  const apiList = state.apiList;
  const apiRows = state.apiRows!;
  if (apiList.previousElementSibling !== sidebar) sidebar.after(apiList);
  // Our list lives outside the native sidebar, so it may not inherit its font size. Recompute
  // only when the ancestor chain changes or the window resized (fontRevision), not every update.
  const fontSource: Element = nativeWorkflows[0] ?? sidebar;
  const fontContext: Array<[string, string, string, string | null]> = [];
  for (let element: Element | null = fontSource; element; element = element.parentElement)
    fontContext.push([
      element.tagName,
      element.id,
      element.className as string,
      element.getAttribute("style"),
    ]);
  const fontSignature = JSON.stringify(fontContext);
  if (state.fontSignature !== fontSignature || state.fontRevision !== fontRevision) {
    apiList.style.fontSize = getComputedStyle(fontSource).fontSize;
    state.fontSignature = fontSignature;
    state.fontRevision = fontRevision;
  }
  const workflowPath = `/${repository}/actions/workflows/`;
  const nativeIds = new Set(
    nativeWorkflows.map((link) => link.pathname.slice(workflowPath.length)),
  );
  const nativeIcon = [...sidebar.querySelectorAll(PIN_SELECTOR)]
    .find((button) => /^Pin\b/i.test(buttonLabel(button)))
    ?.querySelector("svg");
  for (const item of state.index) {
    const id = workflowRoute(item.path);
    if (nativeIds.has(id)) {
      apiRows.get(id)?.remove();
      apiRows.delete(id);
    } else if (!apiRows.has(id)) {
      const requestedRepository = repository;
      const row = document.createElement("li");
      row.className = "gha-workflow-api-row";
      const link = document.createElement("a");
      link.href = `/${repository}/actions/workflows/${id}`;
      link.textContent = item.name;
      if (typeof item.state === "string" && item.state.startsWith("disabled_")) {
        link.setAttribute("data-gha-workflow-disabled", "");
        link.setAttribute("aria-label", `${item.name}, disabled workflow`);
      }
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "gha-workflow-api-pin";
      pin.setAttribute("aria-label", `Pin ${item.name}`);
      pin.title = `Pin ${item.name}`;
      pin.append(nativeIcon?.cloneNode(true) ?? document.createTextNode("Pin"));
      // Pinning is GitHub state owned by the native row: load native rows via "Show more" until
      // the real pin exists, then click it. Wait for any running expansion first (single loop).
      pin.addEventListener("click", async () => {
        if (pin.disabled) return;
        pin.disabled = true;
        try {
          while (
            state.running &&
            controls.isConnected &&
            repository === requestedRepository
          )
            await sleep(CLICK_DELAY_MS);
          if (!controls.isConnected || repository !== requestedRepository) return;
          await loadAllWorkflows(state, controls, id);
          if (!controls.isConnected || repository !== requestedRepository) return;
          const native = nativePin(state.sidebar, id);
          if (native) native.click();
          else console.warn("Could not load pin control for workflow", item.name);
        } finally {
          pin.disabled = false;
        }
      });
      row.append(link, pin);
      apiList.append(row);
      apiRows.set(id, row);
    }
    const link = apiRows.get(id)?.firstElementChild as HTMLAnchorElement | null;
    if (link) {
      if (link.pathname === location.pathname)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
  return [
    ...apiList.querySelectorAll<HTMLAnchorElement>(WORKFLOW_LINKS),
  ];
}

// Nearest scrolling ancestor, cached per element. The cache is validated against the recorded
// ancestor path (parent, class, style, data-expanded) because those changes alter scrolling.
function findScrollContainer(element: Element): Element | null {
  const cached = scrollContainers.get(element);
  if (
    cached?.container.isConnected &&
    cached.path.every(
      ([node, parent, className, style, expanded]) =>
        node.parentElement === parent &&
        node.getAttribute("class") === className &&
        node.getAttribute("style") === style &&
        node.getAttribute("data-expanded") === expanded,
    )
  )
    return cached.container;
  const path: ScrollPath = [];
  for (
    let current: Element | null = element;
    current && current !== document.body;
    current = current.parentElement
  ) {
    path.push([
      current,
      current.parentElement,
      current.getAttribute("class"),
      current.getAttribute("style"),
      current.getAttribute("data-expanded"),
    ]);
    if (["auto", "scroll"].includes(getComputedStyle(current).overflowY)) {
      scrollContainers.set(element, { container: current, path });
      return current;
    }
  }
  return null;
}

// The sidebar's native "Show more" button; ignores hidden ones and our own picker menu buttons.
function findShowMore(sidebar: Element): HTMLButtonElement | undefined {
  if (!sidebar.isConnected) return undefined;
  return Array.from(sidebar.querySelectorAll("button")).find(
    (button) =>
      /^Show more(?: workflows)?(?:\.{3}|…)?$/i.test(
        button.textContent?.trim() ?? "",
      ) && !button.closest("[hidden], .gha-workflow-category-picker"),
  );
}

function nativePin(sidebar: Element, id: string): HTMLElement | null {
  const path = `/${repository}/actions/workflows/${id}`;
  const link = [
    ...sidebar.querySelectorAll<HTMLAnchorElement>(WORKFLOW_LINKS),
  ].find((item) => item.pathname === path);
  return (
    link?.closest("li")?.querySelector<HTMLElement>(PIN_SELECTOR) ?? null
  );
}

// Called when no "Show more" remains: scroll back to the top because expanding the list moves the
// viewport, then stop treating the sidebar as expanding.
function finishExpansion(state: WorkflowState): void {
  if (
    !state.expanding ||
    !state.sidebar.isConnected ||
    findShowMore(state.sidebar)
  )
    return;
  for (
    let element: Element | null = state.sidebar;
    element;
    element = element.parentElement
  )
    element.scrollTop = 0;
  state.expanding = false;
}

// Shows "Loading workflows…" until the index arrives, and restarts a quiet-period timer; when it
// fires (no click or failure for LOADING_TIMEOUT_MS) the text hides and expansion can finish.
function extendLoadingTimeout(
  controls: HTMLElement,
  state: WorkflowState,
): void {
  const loading = controls.querySelector<HTMLElement>(".gha-workflow-loading")!;
  loading.hidden = !!state.index;
  clearTimeout(state.loadingTimeout);
  state.loadingTimeout = setTimeout(() => {
    loading.hidden = true;
    if (controls.isConnected && isActionsPath()) finishExpansion(state);
  }, LOADING_TIMEOUT_MS);
}

// Clicks "Show more" repeatedly until it disappears, polling every CLICK_DELAY_MS. Without a
// targetId it runs until the list is complete. With a targetId (pin click) it stops as soon as
// that native row has a pin, and gives up after PIN_LOADING_TIMEOUT_MS; it only re-clicks the
// same button once more links appeared, to avoid double-loading. Aborts if the page, repository
// or controls changed. The finally block schedules a refresh if the sidebar vanished mid-loop.
async function loadAllWorkflows(
  state: WorkflowState,
  controls: HTMLElement,
  targetId?: string,
): Promise<void> {
  if (state.running) return;
  state.running = true;
  const deadline = targetId ? Date.now() + PIN_LOADING_TIMEOUT_MS : Infinity;
  let clickedButton: HTMLButtonElement | undefined;
  let linkCountAtClick = 0;
  const linkCount = () => state.sidebar.querySelectorAll(WORKFLOW_LINKS).length;
  try {
    while (controls.isConnected && Date.now() < deadline && isActionsPath()) {
      if (targetId && nativePin(state.sidebar, targetId)) break;
      const button = findShowMore(state.sidebar);
      if (!button) {
        if (targetId && clickedButton) {
          await sleep(CLICK_DELAY_MS);
          continue;
        }
        if (
          !targetId &&
          controls.querySelector<HTMLElement>(".gha-workflow-loading")!.hidden
        )
          finishExpansion(state);
        break;
      }
      if (!targetId) state.expanding = true;
      if (
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true" &&
        button.getAttribute("data-loading") !== "true" &&
        (!targetId || button !== clickedButton || linkCount() > linkCountAtClick)
      ) {
        if (!targetId) extendLoadingTimeout(controls, state);
        if (targetId) {
          clickedButton = button;
          linkCountAtClick = linkCount();
        }
        button.click();
      }
      await sleep(CLICK_DELAY_MS);
    }
  } finally {
    state.running = false;
    if (!state.sidebar.isConnected || !isActionsPath()) scheduleUpdate();
  }
}

// The content script survives in-place navigation, so injected UI and query from the previous
// repository must be removed explicitly.
function resetRepository(): void {
  query = "";
  categories.reset();
  document
    .querySelectorAll(".gha-workflow-filter")
    .forEach((element) => element.remove());
  document
    .querySelectorAll(".gha-workflow-api-list")
    .forEach((element) => element.remove());
  document.querySelectorAll("[data-gha-workflow-hidden]").forEach((element) => {
    element.removeAttribute("data-gha-workflow-hidden");
  });
}

// When the Actions aside is collapsed the native list is not rendered, only an overlay flyout.
// Categories are switched off and everything we injected is removed except inside the flyout.
function collapseSidebar(flyout: Element | null): void {
  categories.reset();
  document
    .querySelectorAll(".gha-workflow-filter, .gha-workflow-api-list")
    .forEach((element) => {
      if (!flyout?.parentElement?.contains(element)) element.remove();
    });
  document
    .querySelectorAll(
      'aside[aria-label="Actions"] [data-gha-workflow-hidden], [data-gha-workflow-all-hidden]',
    )
    .forEach((element) => {
      element.removeAttribute("data-gha-workflow-hidden");
      element.removeAttribute("data-gha-workflow-all-hidden");
    });
  document
    .querySelectorAll(".gha-workflow-show-more-hidden")
    .forEach((element) => {
      if (!flyout?.contains(element))
        element.classList.remove("gha-workflow-show-more-hidden");
    });
}

// Builds the filter box and loading text once per host. The fetch resolves later; its result is
// ignored if the controls were removed or the repository changed meanwhile. Typing before the idle
// callback fires shows the index immediately so filtering covers all workflows.
function createControls(sidebar: HTMLElement, host: Element) {
  const controls = document.createElement("div");
  controls.className = "gha-workflow-filter";
  const loading = document.createElement("div");
  loading.className = "gha-workflow-loading";
  loading.setAttribute("role", "status");
  loading.textContent = "Loading workflows…";
  const field = document.createElement("div");
  field.className = "gha-workflow-filter-field";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Filter workflows";
  input.setAttribute("aria-label", "Filter workflows");
  input.autocomplete = "off";
  input.spellcheck = false;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "gha-workflow-filter-clear";
  clear.textContent = "×";
  clear.setAttribute("aria-label", "Clear workflow filter");
  clear.title = "Clear workflow filter";
  clear.hidden = true;
  clear.addEventListener("click", () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
  field.append(input, clear);
  controls.append(loading, field);
  host.prepend(controls);
  const state: WorkflowState = {
    sidebar,
    running: false,
    expanding: false,
    fetching: typeof window.fetch === "function",
  };
  loadingSidebars.set(controls, state);
  input.addEventListener("input", () => {
    query = input.value;
    if (query && state.showIndex) state.showIndex();
    else update();
  });
  if (state.fetching) {
    const requestedRepository = repository;
    loadWorkflowIndex(requestedRepository)
      .then((index) => {
        if (!controls.isConnected || repository !== requestedRepository) return;
        state.showIndex = () => {
          if (
            state.index ||
            !controls.isConnected ||
            repository !== requestedRepository
          )
            return;
          state.showIndex = null;
          state.fetching = false;
          state.index = index;
          loading.hidden = true;
          update();
        };
        if (query) state.showIndex();
        else whenPageIdle(state.showIndex);
      })
      .catch((error) => {
        if (!controls.isConnected || repository !== requestedRepository) return;
        console.warn("Could not fetch workflow list", error);
        state.fetching = false;
        extendLoadingTimeout(controls, state);
        update();
      });
  } else extendLoadingTimeout(controls, state);
  return { controls, input, clear, state };
}

// Flyout mode has no categories view; only the pin state is mirrored onto the row.
function readPinned(link: HTMLAnchorElement): void {
  const row = link.closest("li");
  const pin = row?.querySelector(
    '[data-component="ActionList.TrailingAction"] button',
  );
  const label = pin ? buttonLabel(pin) : "";
  row?.toggleAttribute("data-gha-pinned", /^(?:Unpin|Remove pin)\b/i.test(label));
}

// Single idempotent pass over the page; safe to run repeatedly (scheduler coalesces calls).
// Hands off to the categories view via categories.sync, and via categories.reset when the
// sidebar is collapsed or the repository changes.
function update(): void {
  const currentRepository = actionsRepository(route());
  if (currentRepository !== repository) {
    repository = currentRepository;
    resetRepository();
  }
  if (!repository) return;
  const actionsAside = document.querySelector('aside[aria-label="Actions"]');
  // Flyout is rendered in a Primer portal outside the aside, hence the document-level lookup.
  const collapsed = actionsAside?.getAttribute("data-expanded") === "false";
  const flyout = collapsed
    ? document.querySelector<HTMLElement>(
        '#__primerPortalRoot__ [data-component="AnchoredOverlay"] nav[aria-label="Workflows"]',
      )
    : null;
  if (collapsed) {
    collapseSidebar(flyout);
    if (!flyout) return;
  }

  const workflowPath = `/${repository}/actions/workflows/`;
  const sidebars = new Set<HTMLElement>();
  if (flyout) sidebars.add(flyout);
  else {
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      WORKFLOW_LINKS,
    )) {
      if (
        link.origin !== location.origin ||
        !link.pathname.startsWith(workflowPath)
      )
        continue;
      const sidebar = link.closest<HTMLElement>("nav, actions-workflow-list");
      if (sidebar && (!actionsAside || actionsAside.contains(sidebar)))
        sidebars.add(sidebar);
    }
  }

  const hosts = new Set<Element>();
  for (const sidebar of sidebars) {
    const host = (findScrollContainer(sidebar.parentElement!) ??
      sidebar.parentElement)!;
    hosts.add(host);
    let controls = host.querySelector<HTMLElement>(":scope > .gha-workflow-filter");
    let input = controls?.querySelector("input");
    let clear = controls?.querySelector<HTMLButtonElement>(
      ".gha-workflow-filter-clear",
    );
    let state = controls && loadingSidebars.get(controls);
    if (!input) {
      ({ controls, input, clear, state } = createControls(sidebar, host));
    }
    state!.sidebar = sidebar;
    input.value = query;
    const shouldHideClear = !query;
    if (clear!.hidden !== shouldHideClear) clear!.hidden = shouldHideClear;
    findShowMore(sidebar)?.classList.toggle(
      "gha-workflow-show-more-hidden",
      !!state!.index,
    );

    const nativeWorkflows = Array.from(
      sidebar.querySelectorAll<HTMLAnchorElement>(WORKFLOW_LINKS),
    ).filter(
      (link) =>
        link.origin === location.origin &&
        link.pathname.startsWith(workflowPath),
    );
    const workflows = [
      ...nativeWorkflows,
      ...syncFetchedRows(state!, controls!, sidebar, nativeWorkflows),
    ];
    if (collapsed) {
      nativeWorkflows.forEach(readPinned);
      for (const link of workflows)
        link
          .closest("li")
          ?.toggleAttribute(
            "data-gha-workflow-hidden",
            !link.textContent!.toLowerCase().includes(query.trim().toLowerCase()),
          );
    } else if (!state!.fetching)
      categories.sync(
        repository,
        sidebar,
        workflows,
        query,
        workflowPath,
      );

    if (!state!.fetching && !state!.index) void loadAllWorkflows(state!, controls!);
  }

  // Remove orphaned controls only after a grace period (never while expanding): a host that
  // vanishes mid re-render would otherwise cause controls to be rebuilt and the index load
  // restarted.
  for (const controls of document.querySelectorAll<HTMLElement>(
    ".gha-workflow-filter",
  )) {
    if (
      hosts.has(controls.parentElement!) ||
      loadingSidebars.get(controls)?.running
    ) {
      clearTimeout(cleanupTimers.get(controls));
      cleanupTimers.delete(controls);
    } else if (!cleanupTimers.has(controls)) {
      cleanupTimers.set(
        controls,
        setTimeout(() => {
          cleanupTimers.delete(controls);
          controls.parentElement
            ?.querySelector(":scope > .gha-workflow-categories")
            ?.remove();
          loadingSidebars.get(controls)?.apiList?.remove();
          controls.remove();
        }, LOADING_TIMEOUT_MS),
      );
    }
  }
}

// Relevance heuristics: the observer fires for the whole page, so only mutations that can change
// the sidebar or workflow links trigger an update. Our own injected nodes are excluded to avoid
// feedback loops, and log output is ignored since it mutates constantly.
const SIDEBAR_SELECTOR =
  'aside[aria-label="Actions"], nav[aria-label="Actions workflows"], ' +
  'nav[aria-label="Workflows"], actions-workflow-list, .gha-workflow-filter, ' +
  ".gha-workflow-api-list, .gha-workflow-categories";
const LABEL_BUTTONS =
  'aside[aria-label="Actions"] button[aria-labelledby], ' +
  'nav[aria-label="Actions workflows"] button[aria-labelledby], ' +
  "actions-workflow-list button[aria-labelledby], " +
  'nav[aria-label="Workflows"] button[aria-labelledby]';

function isRelevantMutation({
  target,
  addedNodes,
  removedNodes,
}: MutationRecord): boolean {
  const element = target.nodeType === 1 ? (target as Element) : target.parentElement;
  if (element?.closest(".js-full-logs-container")) return false;
  if (
    element?.closest(
      ".gha-workflow-filter, .gha-workflow-categories, .gha-workflow-api-list",
    )
  )
    return false;
  if (element?.closest(SIDEBAR_SELECTOR)) return true;
  const nav = element?.closest("nav");
  if (nav?.querySelector(WORKFLOW_LINKS)) return true;
  if (
    element?.id &&
    [...document.querySelectorAll(LABEL_BUTTONS)].some((button) =>
      button.getAttribute("aria-labelledby")!.split(/\s+/).includes(element.id),
    )
  )
    return true;
  return [...addedNodes, ...removedNodes].some((node) => {
    if (node.nodeType !== 1) return false;
    const child = node as Element;
    // Our own category view is rebuilt per render; ignore it once one is already in the document.
    if (
      child.matches(".gha-workflow-categories") &&
      document.querySelector(".gha-workflow-categories")
    )
      return false;
    if (
      child.matches(SIDEBAR_SELECTOR) ||
      child.querySelector(`${SIDEBAR_SELECTOR}, nav a[href*="/actions/workflows/"]`)
    )
      return true;
    return (
      nav && (child.matches(WORKFLOW_LINKS) || child.querySelector(WORKFLOW_LINKS))
    );
  });
}

// GitHub replaces navigation in place; a content script only loads once per document.
const scheduler = createPageScheduler({
  update,
  active: () => Boolean(repository || actionsRepository(route())),
  relevant: (records) => {
    // A repository change always updates, so state tied to the old repository is reset.
    if (actionsRepository(route()) !== repository) return true;
    return Boolean(repository) && records.some(isRelevantMutation);
  },
  observe: {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "href",
      "hidden",
      "disabled",
      "aria-disabled",
      "aria-label",
      "aria-current",
      "data-loading",
      "data-expanded",
    ],
  },
  events: ["turbo:load", "popstate"],
});
scheduler.start();
const scheduleUpdate = scheduler.schedule;
window.addEventListener("resize", () => {
  if (!repository) return;
  scrollContainers = new WeakMap();
  fontRevision++;
  scheduleUpdate();
});
update();
