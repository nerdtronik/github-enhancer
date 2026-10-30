/**
 * PR conversation page: timeline filters with counts, per-comment collapse, and sticky header
 * actions. Driven by createPageScheduler at the bottom of the file.
 */
import { createPageScheduler } from "../../core/scheduler";
import { createIcon, store } from "../../core/settings";
import { route } from "../../core/routes";
import { ui } from "../../core/ui";
import { category } from "./category";

const categories = [
  "people",
  "bots",
  "reviews",
  "commits",
  "checks",
  "deployments",
  "activity",
];
const labels = [
  "Human comments",
  "Bot comments",
  "Review decisions",
  "Commits and pushes",
  "Checks",
  "Deployment statuses",
  "Other activity",
];
const rowSelector =
  ".js-timeline-item, .TimelineItem, .timeline-comment, .discussion-item";
let path = "";
// Filter state. When "Remember filters" is on, it is saved under one global "prFilters" record
// (not per PR or repo); otherwise it resets whenever the path changes.
let selected = new Set(categories);
let unresolvedOnly = false;
let includeUnresolved = true;
let rememberFilters = false;
// "prComments" is one record mapping each PR path to its collapsed comment ids.
let collapsedByPr: Record<string, string[]> = {};
let collapsedIds = new Set<string>();
let loaded = false;
const write = store.writer((error) =>
  console.warn("Could not save conversation settings", error),
);
let disposeFilterMenu: (() => void) | undefined;
let controls: HTMLElement | null = null;
let placeholder: HTMLDivElement | undefined = undefined;
let observedStickyHeader: HTMLElement | null | undefined = undefined;
let stickyHeaderObserver: MutationObserver | null = null;
let stickyActions: HTMLElement | null = null;
let stickyActionsHome: Node | null = null;
let stickyActionsNext: Node | null = null;
let stickyTitle: HTMLElement | null = null;

function conversationPath(): string {
  const current = route();
  if (current.kind !== "pull" || current.rest !== "") return "";
  return `/${current.owner}/${current.repo}/pull/${current.number}`;
}

// Fallback chain: the sidebar item marked by a channel event or aria-label, then the heading
// reading "Reviewers", then the first sidebar child that is not ours. We rely on this markup.
function findReviewers(): HTMLElement | null {
  const sidebar = document.querySelector(
    "#partial-discussion-sidebar",
  ) as HTMLElement | null;
  const marker = sidebar?.querySelector(
    '[data-channel-event-name="reviewers_updated"], [aria-label="Select reviewers"]',
  );
  const item = marker?.closest(
    ".discussion-sidebar-item",
  ) as HTMLElement | null;
  if (item) return item;
  const heading = [
    ...(sidebar ?? document).querySelectorAll(
      ".discussion-sidebar-heading, h2, h3, h4",
    ),
  ].find(
    (element) => element.textContent.trim() === "Reviewers",
  ) as HTMLElement | null;
  return (
    heading?.closest(".discussion-sidebar-item, section") ??
    heading?.parentElement ??
    ([...(sidebar?.children ?? [])].find(
      (element) =>
        !element.classList.contains("gha-pr-filters") &&
        !element.classList.contains("gha-pr-filter-placeholder"),
    ) as HTMLElement | null)
  );
}

function resetFixedPosition(): void {
  controls?.classList.remove("gha-pr-filters-fixed");
  controls?.style.removeProperty("left");
  controls?.style.removeProperty("top");
  controls?.style.removeProperty("width");
  placeholder?.remove();
  placeholder = undefined;
}

// Pins the filter panel under the sticky header once it scrolls past. The header bottom only
// counts while the header is is-stuck (else 64px); the panel's rect is measured on each call and
// a placeholder keeps the page from jumping when the panel becomes fixed.
function syncFixedPosition(): void {
  if (!controls?.isConnected || !path) return;
  const headerBottom = observedStickyHeader?.className.includes("is-stuck")
    ? observedStickyHeader.getBoundingClientRect().bottom
    : 0;
  const fixedTop = headerBottom > 0 ? Math.floor(headerBottom) : 64;
  const rect = (placeholder ?? controls).getBoundingClientRect();
  if (!rect.width) {
    resetFixedPosition();
    return;
  }
  if (rect.top >= fixedTop) {
    resetFixedPosition();
    return;
  }
  if (!placeholder) {
    placeholder = document.createElement("div");
    placeholder.className = "gha-pr-filter-placeholder";
    placeholder.style.height = `${rect.height + parseFloat((getComputedStyle(controls).marginBottom || 0) as string)}px`;
    controls.before(placeholder);
  }
  controls.style.left = `${rect.left}px`;
  controls.style.top = `${fixedTop}px`;
  controls.style.width = `${rect.width}px`;
  controls.classList.add("gha-pr-filters-fixed");
}

function clearStickyActions(): void {
  if (stickyActionsHome?.isConnected && stickyActions)
    stickyActionsHome.insertBefore(
      stickyActions,
      stickyActionsNext?.parentNode === stickyActionsHome
        ? stickyActionsNext
        : null,
    );
  else if (stickyActionsHome) stickyActions?.remove();
  stickyActions?.classList.remove("gha-pr-sticky-actions");
  stickyActions?.style.removeProperty("position");
  stickyActions?.style.removeProperty("left");
  stickyActions?.style.removeProperty("top");
  stickyTitle?.classList.remove("gha-pr-title-with-actions");
  stickyTitle?.style.removeProperty("--gha-pr-title-padding");
  stickyTitle?.style.removeProperty("--gha-pr-actions-reserve");
  stickyActions = null;
  stickyActionsHome = null;
  stickyActionsNext = null;
  stickyTitle = null;
}

// While the sticky header is stuck, its actions are moved into it next to the title and
// positioned (fixed) from the measured title and action rects, re-run on resize and header class
// changes. clearStickyActions puts them back where they were.
function syncStickyActions(): void {
  if (!path && !stickyActions) return;
  const sticky = observedStickyHeader;
  const header = sticky?.closest(
    'header[data-component="SplitPageLayout.Header"]',
  );
  if (stickyActionsHome && !stickyActionsHome.isConnected) clearStickyActions();
  const actions =
    stickyActions ?? header?.querySelector('[data-component="PH_Actions"]');
  const title = sticky?.querySelector(
    '[data-component="TitleArea"]',
  ) as HTMLElement | null;
  if (!path || !sticky?.className.includes("is-stuck") || !actions || !title) {
    clearStickyActions();
    return;
  }
  if (actions !== stickyActions || title !== stickyTitle) {
    clearStickyActions();
    stickyActions = actions;
    stickyActionsHome = actions.parentNode;
    stickyActionsNext = actions.nextSibling;
    stickyTitle = title;
    sticky.append(actions);
    title.style.setProperty(
      "--gha-pr-title-padding",
      getComputedStyle(title).paddingRight,
    );
  }
  const titleRect = title.getBoundingClientRect();
  const actionsRect = actions.getBoundingClientRect();
  const padding =
    parseFloat(title.style.getPropertyValue("--gha-pr-title-padding")) || 0;
  if (!titleRect.width || !actionsRect.width) {
    clearStickyActions();
    return;
  }
  const right = Math.min(titleRect.right - padding, window.innerWidth - 16);
  actions.style.setProperty("position", "fixed", "important");
  actions.style.left = `${Math.max(16, Math.round(right - actionsRect.width))}px`;
  const top = Math.round(
    titleRect.y + (titleRect.height - actionsRect.height) / 2,
  );
  actions.style.top = `${Math.max(8, Math.min(top, window.innerHeight - actionsRect.height - 8))}px`;
  title.style.setProperty(
    "--gha-pr-actions-reserve",
    `${Math.ceil(actionsRect.width + 8)}px`,
  );
  title.classList.add("gha-pr-title-with-actions");
  actions.classList.add("gha-pr-sticky-actions");
}

function watchStickyHeader(sticky: HTMLElement | null | undefined): void {
  if (observedStickyHeader === sticky) return;
  stickyHeaderObserver?.disconnect();
  clearStickyActions();
  observedStickyHeader = sticky;
  if (sticky) {
    stickyHeaderObserver = new MutationObserver(() => {
      syncStickyActions();
      syncFixedPosition();
    });
    stickyHeaderObserver.observe(sticky, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}

// Outermost rows only: a nested match is counted as part of its ancestor row.
function timelineRows(root: Element): Element[] {
  return [...root.querySelectorAll(rowSelector)].filter((row) => {
    const parentRow = row.parentElement?.closest(rowSelector);
    return !parentRow || !root.contains(parentRow);
  });
}

function sameSelection(values: string[]): boolean {
  return (
    selected.size === values.length &&
    values.every((value) => selected.has(value))
  );
}

// Cleared (not stored empty) when "Remember filters" is off, so the next load starts fresh.
function persistFilters(): void {
  const snapshot = rememberFilters
    ? {
        selected: [...selected],
        unresolvedOnly,
        includeUnresolved,
      }
    : undefined;
  if (snapshot) void write("prFilters", undefined, snapshot);
  else void write.remove("prFilters");
}

function persistComments(): void {
  if (collapsedIds.size) collapsedByPr[path] = [...collapsedIds];
  else delete collapsedByPr[path];
  const snapshot = { ...collapsedByPr };
  void write("prComments", undefined, snapshot);
}

// Persistence key for a comment: its own id, a .js-comment ancestor id, or a data-gid. With
// none of them (null) the collapsed state still applies but is not saved.
function commentId(card: Element): string | null {
  return (
    card.id ||
    card.closest(".js-comment[id]")?.id ||
    (card.closest("[data-gid]")?.getAttribute("data-gid") as string | null)
  );
}

function isUnresolvedThread(row: Element): boolean {
  return !!row.querySelector(
    'review-thread-collapsible[data-resolved="false"]',
  );
}

function setCommentCollapsed(
  card: Element,
  header: HTMLElement,
  collapsed: boolean,
): void {
  card.toggleAttribute("data-gha-pr-comment-collapsed", collapsed);
  for (
    let node = header;
    node !== card;
    node = node.parentElement as HTMLElement
  )
    for (const sibling of node.parentElement!.children)
      if (sibling !== node)
        sibling.toggleAttribute("data-gha-pr-comment-hidden", collapsed);
  const button = header.querySelector(".gha-pr-comment-toggle");
  button?.setAttribute(
    "aria-label",
    `${collapsed ? "Expand" : "Collapse"} comment`,
  );
  button?.setAttribute("aria-expanded", String(!collapsed));
  const id = commentId(card);
  if (id) {
    if (collapsed) collapsedIds.add(id);
    else collapsedIds.delete(id);
  }
}

function syncAllCommentsButton(): void {
  const all = controls?.querySelector(
    ".gha-pr-comment-toggle-all",
  ) as HTMLButtonElement;
  if (!all) return;
  const buttons = [
    ...document.querySelectorAll(
      ".pull-discussion-timeline .gha-pr-comment-toggle",
    ),
  ] as HTMLButtonElement[];
  const action =
    !buttons.length ||
    buttons.some((button) => button.getAttribute("aria-expanded") === "true")
      ? "Collapse"
      : "Expand";
  all.disabled = !buttons.length;
  if (all.textContent !== `${action} all`) all.textContent = `${action} all`;
  all.setAttribute("aria-label", `${action} all comments`);
}

// Runs on every update and re-applies state from collapsedIds and the collapsed attribute:
// nodes that appear or are replaced later lack our attributes and toggle button.
function enhanceComments(): void {
  for (const card of document.querySelectorAll(
    ".pull-discussion-timeline .timeline-comment",
  )) {
    const header = [...card.querySelectorAll(".timeline-comment-header")].find(
      (element) => element.closest(".timeline-comment") === card,
    ) as HTMLElement;
    if (!header) continue;
    if (collapsedIds.has(commentId(card)!))
      setCommentCollapsed(card, header, true);
    if (!header.querySelector(".gha-pr-comment-toggle")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gha-pr-comment-toggle";
      button.append(createIcon("chevron-down"));
      const collapsed = card.hasAttribute("data-gha-pr-comment-collapsed");
      button.setAttribute(
        "aria-label",
        `${collapsed ? "Expand" : "Collapse"} comment`,
      );
      button.setAttribute("aria-expanded", String(!collapsed));
      button.addEventListener("click", () => {
        const collapsed = !card.hasAttribute("data-gha-pr-comment-collapsed");
        setCommentCollapsed(card, header, collapsed);
        if (commentId(card)) persistComments();
        syncAllCommentsButton();
      });
      header.prepend(button);
    }
    if (card.hasAttribute("data-gha-pr-comment-collapsed"))
      setCommentCollapsed(card, header, true);
  }
}

function render(): void {
  if (!controls?.isConnected) return;
  const root = document.querySelector(
    ".pull-discussion-timeline .js-discussion",
  ) as HTMLElement | null;
  if (!root) return;
  // The first comment container is the PR description card; category() skips it.
  const description = root.querySelector(
    ".js-comment-container",
  ) as HTMLElement | null;
  let shown = 0;
  let total = 0;
  const counts = new Map<string, number>(
    ["unresolved", ...categories].map((value) => [value, 0]),
  );
  for (const row of timelineRows(root)) {
    // A null kind (description, "Load more") is neither counted nor hidden.
    const kind = category(row, description);
    const unresolved = !!kind && isUnresolvedThread(row);
    const visible =
      !!kind &&
      (unresolvedOnly
        ? unresolved
        : selected.has(kind) && (includeUnresolved || !unresolved));
    row.toggleAttribute("data-gha-pr-hidden", !!kind && !visible);
    if (kind) {
      total++;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (unresolved)
        counts.set("unresolved", (counts.get("unresolved") ?? 0) + 1);
      if (visible) shown++;
    }
  }
  const count = controls.querySelector(".gha-pr-filter-count") as HTMLElement;
  const message = `${shown} of ${total} loaded shown`;
  if (count.textContent !== message) count.textContent = message;
  for (const button of controls.querySelectorAll(
    "[data-gha-pr-view]",
  ) as unknown as HTMLButtonElement[]) {
    if (button.dataset.ghaPrView === "unresolved") {
      button.setAttribute("aria-pressed", String(unresolvedOnly));
      continue;
    }
    const view = button.dataset.ghaPrView as string;
    const values =
      view === "all"
        ? categories
        : view === "comments"
          ? ["people", "bots"]
          : [view];
    button.setAttribute(
      "aria-pressed",
      String(!unresolvedOnly && includeUnresolved && sameSelection(values)),
    );
  }
  for (const input of controls.querySelectorAll(
    "input[data-gha-pr-category]",
  ) as unknown as HTMLInputElement[])
    input.checked =
      input.value === "unresolved"
        ? includeUnresolved
        : selected.has(input.value);
  (
    controls.querySelector(".gha-pr-filter-remember input") as HTMLInputElement
  ).checked = rememberFilters;
  (
    controls.querySelector(".gha-pr-filter-menu") as HTMLElement
  ).dataset.active = String(
    unresolvedOnly || !includeUnresolved || !sameSelection(categories),
  );
  for (const badge of controls.querySelectorAll(
    "[data-gha-pr-count]",
  ) as unknown as HTMLSpanElement[]) {
    const value = String(counts.get(badge.dataset.ghaPrCount as string));
    if (badge.textContent !== value) badge.textContent = value;
  }
  syncAllCommentsButton();
}

function makeControls(): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "gha-pr-filters";
  panel.setAttribute("aria-label", "Conversation filters");
  const heading = document.createElement("div");
  heading.className = "gha-pr-filter-heading";
  heading.textContent = "Conversation filters";
  const count = document.createElement("div");
  count.className = "gha-pr-filter-count";
  count.setAttribute("role", "status");
  const header = document.createElement("div");
  header.className = "gha-pr-filter-header";
  header.append(heading, count);
  const views = document.createElement("div");
  views.className = "gha-pr-filter-views";
  for (const [value, label] of [
    ["all", "All"],
    ["unresolved", "Unresolved"],
    ["people", "People"],
    ["bots", "Bots"],
    ["comments", "Comments only"],
  ]) {
    if (views.childNodes.length) {
      const separator = document.createElement("span");
      separator.className = "gha-pr-filter-separator";
      separator.setAttribute("aria-hidden", "true");
      separator.textContent = "·";
      views.append(" ", separator, " ");
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.ghaPrView = value;
    button.textContent = label;
    button.addEventListener("click", () => {
      unresolvedOnly = value === "unresolved";
      includeUnresolved = true;
      selected = new Set(
        value === "all"
          ? categories
          : value === "unresolved"
            ? []
            : value === "comments"
              ? ["people", "bots"]
              : [value],
      );
      render();
      if (rememberFilters) persistFilters();
    });
    views.append(button);
  }
  const filter = document.createElement("details");
  filter.className = "gha-pr-filter-menu";
  const trigger = document.createElement("summary");
  trigger.append(createIcon("filter"), "Filter activity");
  const options = document.createElement("div");
  options.className = "gha-pr-filter-options";
  const title = document.createElement("div");
  title.className = "gha-pr-filter-options-heading";
  title.textContent = "Show in timeline";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Show all";
  clear.addEventListener("click", () => {
    selected = new Set(categories);
    unresolvedOnly = false;
    includeUnresolved = true;
    render();
    if (rememberFilters) persistFilters();
  });
  title.append(clear);
  options.append(title);
  [
    ["unresolved", "Unresolved review threads"],
    ...categories.map((value, index) => [value, labels[index]]),
  ].forEach(([value, text]) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.dataset.ghaPrCategory = "";
    input.checked = true;
    input.addEventListener("change", () => {
      if (value === "unresolved") {
        includeUnresolved = input.checked;
        if (unresolvedOnly && !includeUnresolved) {
          unresolvedOnly = false;
          selected = new Set(categories);
        }
      } else {
        if (unresolvedOnly) {
          unresolvedOnly = false;
          selected.clear();
        }
        if (input.checked) selected.add(value);
        else selected.delete(value);
      }
      render();
      if (rememberFilters) persistFilters();
    });
    const count = document.createElement("span");
    count.className = "gha-pr-filter-option-count";
    count.dataset.ghaPrCount = value;
    label.append(input, text, count);
    options.append(label);
  });
  const remember = document.createElement("label");
  remember.className = "gha-pr-filter-remember";
  const rememberInput = document.createElement("input");
  rememberInput.type = "checkbox";
  rememberInput.checked = rememberFilters;
  rememberInput.addEventListener("change", () => {
    rememberFilters = rememberInput.checked;
    persistFilters();
  });
  remember.append(rememberInput, "Remember filters");
  options.append(remember);
  filter.append(trigger, options);
  disposeFilterMenu = ui.detailsMenu(filter);
  const allComments = document.createElement("button");
  allComments.type = "button";
  allComments.className = "gha-pr-comment-toggle-all";
  allComments.addEventListener("click", () => {
    const buttons = [
      ...document.querySelectorAll(
        ".pull-discussion-timeline .gha-pr-comment-toggle",
      ),
    ] as HTMLButtonElement[];
    const collapse = buttons.some(
      (button) => button.getAttribute("aria-expanded") === "true",
    );
    for (const button of buttons) {
      const card = button.closest(".timeline-comment") as Element;
      if (card.hasAttribute("data-gha-pr-comment-collapsed") !== collapse)
        setCommentCollapsed(
          card,
          button.closest(".timeline-comment-header") as HTMLElement,
          collapse,
        );
    }
    if (buttons.length) persistComments();
    syncAllCommentsButton();
  });
  panel.append(header, views, filter, allComments);
  return panel;
}

function update(): void {
  if (!loaded) return;
  const nextPath = conversationPath();
  if (!nextPath && !path) return;
  if (path !== nextPath) {
    resetFixedPosition();
    watchStickyHeader(undefined);
    for (const button of document.querySelectorAll(".gha-pr-comment-toggle"))
      button.remove();
    for (const element of document.querySelectorAll(
      "[data-gha-pr-comment-collapsed], [data-gha-pr-comment-hidden]",
    )) {
      element.removeAttribute("data-gha-pr-comment-collapsed");
      element.removeAttribute("data-gha-pr-comment-hidden");
    }
    path = nextPath;
    collapsedIds = new Set(collapsedByPr[path] ?? []);
    if (!rememberFilters) {
      selected = new Set(categories);
      unresolvedOnly = false;
      includeUnresolved = true;
    }
    controls?.remove();
    controls = null;
    disposeFilterMenu?.();
    document
      .querySelectorAll("[data-gha-pr-hidden]")
      .forEach((row) => row.removeAttribute("data-gha-pr-hidden"));
  }
  for (const stale of document.querySelectorAll(".gha-pr-filters"))
    if (stale !== controls) stale.remove();
  if (!path) return;
  // We rely on the PageHeader's class containing "stickyHeader" (a generated name, hence the
  // substring match) and on an is-stuck class while it is stuck.
  watchStickyHeader(
    document.querySelector(
      'header[data-component="SplitPageLayout.Header"] [data-component="PageHeader"][class*="stickyHeader"]',
    ) as HTMLElement | null,
  );
  syncStickyActions();
  enhanceComments();
  const reviewers = findReviewers();
  if (
    !reviewers ||
    !document.querySelector(".pull-discussion-timeline .js-discussion")
  )
    return;
  if (!controls) controls = makeControls();
  if (controls.nextElementSibling !== reviewers) {
    resetFixedPosition();
    reviewers.before(controls);
  }
  render();
  syncFixedPosition();
}

createPageScheduler({
  update,
  active: () => Boolean(path || conversationPath()),
  relevant: () => Boolean(path || conversationPath()),
  observe: {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-resolved"],
  },
  events: ["turbo:load", "popstate"],
}).start();
window.addEventListener("scroll", syncFixedPosition, { passive: true });
window.addEventListener("resize", () => {
  syncFixedPosition();
  syncStickyActions();
});
Promise.all([
  store.read<{ selected?: string[]; unresolvedOnly?: boolean; includeUnresolved?: boolean } | undefined>("prFilters"),
  store.read<Record<string, string[]>>("prComments"),
])
  .then(([filters, comments]) => {
    if (filters && Array.isArray(filters.selected)) {
      rememberFilters = true;
      selected = new Set(
        filters.selected.filter((value) =>
          categories.includes(value as string),
        ),
      );
      unresolvedOnly = filters.unresolvedOnly === true;
      includeUnresolved = filters.includeUnresolved !== false;
    }
    if (comments && typeof comments === "object" && !Array.isArray(comments))
      collapsedByPr = comments;
  })
  .catch((error) => console.warn("Could not load conversation view", error))
  .finally(() => {
    loaded = true;
    update();
  });
