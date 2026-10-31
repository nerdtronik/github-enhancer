/**
 * Entry point of the run page enhancement. It runs in the page's MAIN world because it replaces
 * methods on GitHub's `action-graph` custom element, which an isolated world cannot reach, so
 * settings arrive over the postMessage bridge (`settings.ready`) instead of extension storage.
 */
import { createPageScheduler } from "../../core/scheduler";
import { settings } from "../../core/settings";
import { groupJobs, labelDeploymentLinks } from "./jobs";
import {
  collapseRunSections,
  groupSummaries,
  moveWorkflowInfo,
} from "./sections";
import { addScrollbar } from "./toolbar";
import {
  isRunPage,
  layoutMethods,
  scheduleUpdate,
  setScheduler,
  state,
} from "./shared";

const {
  scrollbars,
  workflowInfos,
  expandedSections,
  collapsedStageGroups,
  selectedStatuses,
  adapted,
} = state;

const enhanced = () => settings.get("actionRun_enhancedViewEnabled");
const collapsible = () => settings.get("actionRun_collapsibleSectionsEnabled");
// The enhanced jobs view and the collapsible sections are independent switches; the page-level
// bookkeeping (run reset, #hash sync, click handling) is needed when either one is on.
const active = () => enhanced() || collapsible();

// Drops state for graphs that Turbo navigation or a re-render replaced: a detached graph, or a
// graph whose canvas/stages elements were swapped out under the same `action-graph`, would leave
// a toolbar bound to dead nodes.
function pruneStale(): void {
  for (const [graph, info] of workflowInfos) {
    if (graph.isConnected) continue;
    info.remove();
    workflowInfos.delete(graph);
  }
  for (const [graph, scrollbar] of scrollbars) {
    const current =
      graph.isConnected &&
      graph.querySelector('[data-target="action-graph.canvas"]') ===
        scrollbar.canvas &&
      graph.querySelector('[data-target="action-graph.stages"]') ===
        scrollbar.stages;
    if (current) continue;
    scrollbar.remove();
    scrollbars.delete(graph);
  }
}

// Search, filters and expand/collapse memory belong to one run; clear them when the path changes.
function resetForNewRun(): void {
  if (state.runPath === location.pathname) return;
  state.runPath = location.pathname;
  selectedStatuses.clear();
  clearTimeout(state.searchTimeout);
  state.searchTimeout = undefined;
  state.jobSearch = "";
  state.appliedSearch = "";
  expandedSections.clear();
  collapsedStageGroups.clear();
  state.sectionHash = null;
}

// A #hash that targets a job summary must open the collapsed Summaries section. Returns the
// summary to scroll to, or null when the hash is unchanged, not yet in the DOM (retry on the next
// update) or not a summary.
function syncSectionHash(): HTMLElement | null {
  if (state.sectionHash === location.hash) return null;
  const target = document.getElementById(location.hash.slice(1));
  if (location.hash && !target) return null;
  state.sectionHash = location.hash;
  if (!target?.matches("job-summary")) return null;
  expandedSections.add("summaries");
  return target;
}

// Takes over one `action-graph`. Bails out until the element is upgraded (its layout methods exist)
// and its canvas/stages/visualGraph targets are rendered, since both can arrive late.
function adaptGraph(graph: HTMLElement): void {
  if (!layoutMethods.every((name) => typeof graph[name] === "function")) return;
  const canvas = graph.querySelector(
    '[data-target="action-graph.canvas"]',
  ) as HTMLCanvasElement | null;
  const stages = graph.querySelector(
    '[data-target="action-graph.stages"]',
  ) as HTMLElement | null;
  const visualGraph = graph.querySelector(
    '[data-target="action-graph.visualGraph"]',
  );
  if (!canvas || !stages || !visualGraph) return;

  if (!scrollbars.has(graph)) addScrollbar(graph, canvas, stages);
  moveWorkflowInfo(graph, canvas);
  const scrollbar = scrollbars.get(graph);
  scrollbar?.prepare();
  scrollbar?.updateCounts(groupJobs(graph));
  scrollbar?.refresh();
  if (adapted.has(graph)) return;

  // GitHub lays the graph out as absolutely positioned cards and draws connector lines for that
  // layout. We render it as a scrollable list of stages instead, so those methods are replaced
  // with no-ops (once per graph) to stop GitHub from fighting our CSS layout.
  for (const name of layoutMethods) (graph as any)[name] = () => {};
  (graph as any).clearHighlightedGroups?.();
  graph.classList.add("gha-run-list");
  adapted.add(graph);
}

// Runs on every scheduled DOM change. The root class gates all CSS, so it is toggled before the
// early returns. Section grouping/collapsing is skipped when "Collapsible sections" is off so the
// page stays exactly as GitHub renders it; graphs are still adapted either way.
function update(): void {
  const runPage = isRunPage();
  document.documentElement?.classList.toggle(
    "gha-run-view-enabled",
    enhanced() && runPage,
  );
  if (!active()) return;
  if (enhanced()) pruneStale();
  if (!runPage) return;
  resetForNewRun();
  const linkedSummary = syncSectionHash();
  if (collapsible()) {
    groupSummaries();
    collapseRunSections();
    linkedSummary?.scrollIntoView({ block: "start" });
  }
  if (!enhanced()) return;
  for (const graph of document.querySelectorAll("action-graph")) {
    adaptGraph(graph as HTMLElement);
    labelDeploymentLinks(graph as HTMLElement);
  }
}

// One delegated listener: stage-group headings and section toggles are re-created by updates,
// so direct listeners would be lost. Same-page #links reset sectionHash so the hash sync reruns
// and opens the linked summary.
function onClick(event: MouseEvent): void {
  if (!active()) return;
  const target = event.target as HTMLElement;
  const stageHeading = target.closest?.(
    "button.gha-run-status-heading",
  ) as HTMLElement | null;
  if (
    enhanced() &&
    settings.get("actionRun_statusGroupingEnabled") &&
    stageHeading?.closest("action-graph.gha-run-list")
  ) {
    const key = `${stageHeading.dataset.stageNumber}:${stageHeading.dataset.status}`;
    if (!collapsedStageGroups.delete(key)) collapsedStageGroups.add(key);
    return scheduleUpdate();
  }
  const link = target.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
  if (link?.hash && link.pathname === location.pathname) {
    state.sectionHash = null;
    scheduleUpdate();
  }
  const button = target.closest?.(
    ".gha-run-section-toggle",
  ) as HTMLElement | null;
  if (!button) return;
  const key = button.dataset.sectionKey as string;
  if (!expandedSections.delete(key)) expandedSections.add(key);
  scheduleUpdate();
}

function onSettingChange(key: string): void {
  switch (key) {
    case "actionRun_enhancedViewEnabled":
    case "actionRun_collapsibleSectionsEnabled":
      return scheduleUpdate();
    case "actionRun_jobsViewHeight": {
      const height = settings.get("actionRun_jobsViewHeight");
      for (const { canvas } of scrollbars.values()) {
        if (height === null) canvas.style.removeProperty("--gha-run-canvas-height");
        else canvas.style.setProperty("--gha-run-canvas-height", `${height}px`);
      }
      return;
    }
    case "actionRun_hoverFocusEnabled":
      return scrollbars.forEach((scrollbar) => scrollbar.syncHoverToggle());
    case "actionRun_statusGroupingEnabled":
      if (!settings.get("actionRun_statusGroupingEnabled"))
        collapsedStageGroups.clear();
      scrollbars.forEach((scrollbar) => scrollbar.syncGroupingToggle());
      return scheduleUpdate();
    case "actionRun_searchPosition":
      return scrollbars.forEach((scrollbar) => scrollbar.syncSearchPosition());
    case "actionRun_arrowPlacement":
      return scrollbars.forEach((scrollbar) => scrollbar.syncArrowPlacement());
  }
}

// `settings.ready` must resolve first: this world has no storage access and only gets values from
// the bridge.
async function init(): Promise<void> {
  await settings.ready;
  const scheduler = createPageScheduler({
    update,
    idle: true,
    active: () =>
      isRunPage() ||
      scrollbars.size > 0 ||
      workflowInfos.size > 0 ||
      document.documentElement.classList.contains("gha-run-view-enabled"),
    relevant: () =>
      active() && (isRunPage() || scrollbars.size > 0 || workflowInfos.size > 0),
    observe: {
      target: document,
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "data-concluded"],
    },
    events: ["turbo:load", "popstate", "hashchange"],
  });
  setScheduler(scheduler);
  settings.onChange(onSettingChange);
  customElements.whenDefined("action-graph").then(scheduleUpdate);
  document.addEventListener("click", onClick);
  scheduler.start();
}

void init();
