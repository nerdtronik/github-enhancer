/** Search box and status filter popup for the job graph, plus counts and a live-region summary. */
import { createIcon } from "../../core/settings";
import { ui } from "../../core/ui";
import { createListeners, scheduleUpdate, state, statusOptions } from "./shared";

const { selectedStatuses } = state;

export interface JobFilter {
  element: HTMLElement;
  status: HTMLElement;
  place(position: string): void;
  updateCounts(counts: Map<string, number | string>): void;
  sync(): void;
  dispose(): void;
}

export function createJobFilter(options: {
  graph: HTMLElement;
  canvas: HTMLElement;
  controls: HTMLElement;
  bar: HTMLElement;
}): JobFilter {
  const { graph, canvas, controls, bar } = options;
  const { listen, dispose: removeListeners } = createListeners();

  const search = document.createElement("input");
  search.type = "search";
  search.className = "form-control input-sm gha-run-job-search";
  search.setAttribute("aria-label", "Search jobs");
  search.placeholder = "Search jobs";
  search.value = state.jobSearch;

  const searchWrap = document.createElement("div");
  searchWrap.className = "gha-run-job-search-wrap";

  const clearSearch = document.createElement("button");
  clearSearch.type = "button";
  clearSearch.className = "gha-run-job-search-clear";
  clearSearch.setAttribute("aria-label", "Clear job search");
  clearSearch.textContent = "×";
  clearSearch.hidden = !search.value;

  searchWrap.append(search, clearSearch);

  const applySearch = () => {
    state.searchTimeout = undefined;
    state.appliedSearch = state.jobSearch;
    canvas.scrollTop = 0;
    canvas.scrollLeft = 0;
    scheduleUpdate();
  };

  // Typing is debounced 250ms so a large graph is not regrouped on every keystroke; clearing
  // applies immediately.
  const searchJobs = (immediate: boolean = false) => {
    state.jobSearch = search.value;
    clearSearch.hidden = !search.value;
    clearTimeout(state.searchTimeout ?? undefined);
    if (immediate) applySearch();
    else state.searchTimeout = setTimeout(applySearch, 250);
  };

  listen(search, "input", () => searchJobs());
  listen(clearSearch, "click", () => {
    search.value = "";
    searchJobs(true);
    search.focus();
  });

  const filter = document.createElement("details");
  filter.className = "gha-run-hide-filter";
  const trigger = document.createElement("summary");
  trigger.className = "gha-run-hide-trigger";
  const triggerLabel = document.createElement("span");
  triggerLabel.textContent = "Filter jobs";
  trigger.append(createIcon("filter"), triggerLabel);

  const popup = document.createElement("div");
  popup.className = "gha-run-hide-options";
  const group = document.createElement("div");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Filter jobs by status");

  const heading = document.createElement("div");
  heading.className = "gha-run-hide-heading";
  const headingLabel = document.createElement("span");
  headingLabel.textContent = "Filter jobs by status";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn-link";
  clear.textContent = "Show all jobs";
  heading.append(headingLabel, clear);
  group.append(heading);

  const checkboxes = new Map<HTMLInputElement, string>();
  const countLabels = new Map<string, HTMLElement>();
  for (const [status, name, icon] of statusOptions) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = status;
    const count = document.createElement("span");
    count.className = "gha-run-hide-count";
    count.textContent = "0";
    label.append(checkbox, createIcon(icon), name, count);
    group.append(label);
    checkboxes.set(checkbox, status);
    countLabels.set(status, count);
  }

  const updateCounts = (counts: Map<string, number | string>) => {
    for (const [status, label] of countLabels) {
      const value = String(counts.get(status));
      if (label.textContent !== value) label.textContent = value;
    }
  };

  const select = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    const status = checkboxes.get(target);
    if (!status) return;
    if (target.checked) selectedStatuses.add(status);
    else selectedStatuses.delete(status);
    scheduleUpdate();
  };

  const reset = () => {
    selectedStatuses.clear();
    scheduleUpdate();
  };

  // Opens the popup downward unless there is too little room below and more above; its height is
  // capped to the available space (max 420px) so it never leaves the viewport. The scrollbar's
  // sticky `top` offset is subtracted from the room above.
  const fit = () => {
    if (!filter.open) return;
    const bounds = controls.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 20;
    const above =
      bounds.top - (parseFloat(getComputedStyle(bar).top) || 0) - 20;
    const upwards = below < Math.min(420, popup.scrollHeight) && above > below;
    popup.style.top = upwards ? "auto" : "calc(100% + 8px)";
    popup.style.bottom = upwards ? "calc(100% + 8px)" : "auto";
    popup.style.maxHeight = `${Math.max(0, Math.min(420, upwards ? above : below))}px`;
  };

  listen(group, "change", select);
  listen(clear, "click", reset);
  listen(filter, "toggle", fit);
  const disposeMenu = ui.detailsMenu(filter, { stopPropagation: true });
  listen(window, "resize", fit);
  listen(window, "scroll", fit, { passive: true });
  popup.append(group);
  filter.append(trigger, popup);

  const searchFilter = document.createElement("div");
  searchFilter.className = "gha-run-search-filter";
  searchFilter.append(searchWrap, filter);

  const jobTools = document.createElement("div");
  jobTools.className = "gha-run-job-tools";
  jobTools.append(searchFilter);

  const status = document.createElement("span");
  status.className = "gha-run-filter-status";
  status.setAttribute("role", "status");

  const place = (position: string) => {
    if (position === "left") {
      if (searchFilter.firstElementChild !== filter)
        searchFilter.insertBefore(filter, searchWrap);
      return;
    }
    if (searchFilter.firstElementChild !== searchWrap)
      searchFilter.insertBefore(searchWrap, filter);
  };

  const sync = () => {
    if (search.value !== state.jobSearch) search.value = state.jobSearch;
    clearSearch.hidden = !search.value;
    for (const [checkbox, value] of checkboxes)
      checkbox.checked = selectedStatuses.has(value);

    const selection =
      selectedStatuses.size === 1
        ? statusOptions.find(([value]) => selectedStatuses.has(value))?.[1]
        : `${selectedStatuses.size} selected`;
    const label = selectedStatuses.size ? selection : "Filter jobs";
    if (triggerLabel.textContent !== label)
      triggerLabel.textContent = label ?? "";

    const accessibleLabel = selectedStatuses.size
      ? `Filter jobs: ${selection}`
      : "Filter jobs";
    if (trigger.getAttribute("aria-label") !== accessibleLabel)
      trigger.setAttribute("aria-label", accessibleLabel);

    const resultCount = graph.querySelectorAll(
      ".WorkflowStage > .WorkflowCard:not([data-gha-status-hidden]):not([data-gha-scope-hidden])",
    ).length;
    const announcement =
      selectedStatuses.size || state.appliedSearch
        ? `${resultCount} matching job ${resultCount === 1 ? "card" : "cards"}`
        : "";
    if (status.textContent !== announcement) status.textContent = announcement;

    clear.disabled = selectedStatuses.size === 0;
    fit();
  };

  // Pending search is committed (not dropped) so the view matches the text left in `state`.
  const dispose = () => {
    disposeMenu();
    removeListeners();
    clearTimeout(state.searchTimeout ?? undefined);
    state.searchTimeout = undefined;
    state.appliedSearch = state.jobSearch;
  };

  return { element: jobTools, status, place, updateCounts, sync, dispose };
}
