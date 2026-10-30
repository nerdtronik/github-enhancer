/**
 * Content script entry: keeps the Enterprise tab in sync with the header and its colors with the
 * theme.
 */
import { createPageScheduler } from "../../core/scheduler";
import { isRelevantMutation, OBSERVE_INIT, refreshEnterpriseBackground, syncEnterpriseTab } from "./enterpriseRow";
import { watchThemeChanges } from "./themeWatch";

// A failure here must never break the page, so it is logged and skipped.
function guarded(task: (doc: Document) => void): void {
  try {
    task(document);
  } catch (error) {
    console.warn("Enterprise header: could not update the tab", error);
  }
}

const scheduler = createPageScheduler({
  update: () => guarded(syncEnterpriseTab),
  relevant: isRelevantMutation,
  observe: { target: document.documentElement, ...OBSERVE_INIT },
  events: ["turbo:load", "popstate"],
});

let frame = 0;

// Several theme mutations can arrive in one frame; recolor once per frame.
function refreshBackground(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    guarded(refreshEnterpriseBackground);
  });
}

scheduler.start();
scheduler.schedule();
watchThemeChanges(document, refreshBackground);
