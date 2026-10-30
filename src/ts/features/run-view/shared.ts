/** Shared types, per-page state and constants for the run view modules. */
import { isRunPage } from "../../core/routes";
import type { PageScheduler } from "../../core/scheduler";
import { shared } from "../../core/settings";

export { isRunPage };

export interface Scrollbar {
  canvas: HTMLElement;
  stages: HTMLElement;
  prepare: () => void;
  refresh: () => void;
  updateCounts: (counts: Map<string, number | string>) => void;
  syncHoverToggle: () => void;
  syncGroupingToggle: () => void;
  syncSearchPosition: () => void;
  syncArrowPlacement: () => void;
  remove: () => void;
}

export interface RunViewState {
  adapted: WeakSet<HTMLElement>;
  scrollbars: Map<HTMLElement, Scrollbar>;
  workflowInfos: Map<HTMLElement, HTMLElement>;
  selectedStatuses: Set<string>;
  expandedSections: Set<string>;
  collapsedStageGroups: Set<string>;
  jobSearch: string;
  appliedSearch: string;
  searchTimeout: ReturnType<typeof setTimeout> | undefined;
  jobsViewHeight: number | undefined;
  settingsToggleId: number;
  runPath: string;
  sectionHash: string | null;
}

// Via `shared` so separately built bundles on the page reuse one state object.
export const state = shared<RunViewState>("runViewState", () => ({
  adapted: new WeakSet(),
  scrollbars: new Map(),
  workflowInfos: new Map(),
  selectedStatuses: new Set(),
  expandedSections: new Set(),
  collapsedStageGroups: new Set(),
  jobSearch: "",
  appliedSearch: "",
  searchTimeout: undefined,
  jobsViewHeight: undefined,
  settingsToggleId: 0,
  runPath: "",
  sectionHash: null,
}));

// Status filter options as [status, label, icon name].
// Status options as [status, label, icon name].
export const statusOptions: [string, string, string][] = [
  ["completed", "Completed", "check-circle"],
  ["failed", "Failed", "x-circle"],
  ["waiting", "Waiting", "clock"],
  ["active", "In progress", "sync"],
  ["action-required", "Action required", "bell"],
  ["cancelled", "Cancelled", "stop"],
  ["skipped", "Skipped", "skip"],
  ["timed-out", "Timed out", "stopwatch"],
];
// Status groups in display order; cards are ordered by their index in this list.
export const groups: string[] = ["completed", "active", "skipped", "cancelled"];
export const groupLabels: string[] = [
  "Completed",
  "Active / pending",
  "Skipped",
  "Cancelled",
];
// `action-graph` methods that position cards and draw lines; replaced with no-ops in `adaptGraph`.
export const layoutMethods: string[] = [
  "drawLines",
  "fitToWindow",
  "setHighlightedGroup",
  "setDownstreamHighlightGroups",
];

export interface Listeners {
  listen<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions,
  ): void;
  dispose(): void;
}

/** Tracks listeners added through `listen` so `dispose` removes exactly those. */
export function createListeners(): Listeners {
  const entries: [EventTarget, string, EventListener, AddEventListenerOptions | undefined][] = [];
  return {
    listen(target, type, handler, options) {
      target.addEventListener(type, handler as EventListener, options);
      entries.push([target, type, handler as EventListener, options]);
    },
    dispose() {
      for (const [target, type, handler, options] of entries)
        target.removeEventListener(type, handler, options);
    },
  };
}

// Set once by index.ts; lets leaf modules request an update without importing it (no cycle).
let scheduler: PageScheduler | undefined;

export function setScheduler(value: PageScheduler): void {
  scheduler = value;
}

export function scheduleUpdate(): void {
  scheduler?.schedule();
}
