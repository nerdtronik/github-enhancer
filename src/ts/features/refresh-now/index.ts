/**
 * "Refresh now" button next to GitHub's auto-refresh dropdown, so the refresh does not require
 * opening the menu. It opens the menu out of sight, clicks GitHub's own "Refresh now" item (so
 * GitHub's refresh logic runs), and then ignores clicks for a few seconds.
 */
import { createPageScheduler } from "../../core/scheduler";
import { createIcon } from "../../core/settings";
import { installTooltips } from "../../core/tooltip";
import { BUTTON_CLASS, COOLDOWN_MS, findRefreshItem, findTrigger, isContentUpdate } from "./refreshNow";

const OPEN_TIMEOUT_MS = 1000;
const HIDING_ATTR = "data-gha-refreshing";

// Loading lasts until the refreshed content shows up (a page mutation outside our own UI) or
// COOLDOWN_MS at most; clicks are ignored meanwhile, which is the protection against spamming.
let loading = false;
let loadingTimer = 0;
let contentWatcher: MutationObserver | null = null;
let button: HTMLButtonElement | null = null;

function waitForItem(): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      const item = findRefreshItem();
      if (item || Date.now() - started > OPEN_TIMEOUT_MS) resolve(item);
      else setTimeout(poll, 20);
    };
    poll();
  });
}

async function refresh(trigger: HTMLButtonElement): Promise<void> {
  // The menu is hidden by CSS while we drive it, so it does not flash open.
  document.documentElement.setAttribute(HIDING_ATTR, "");
  try {
    trigger.click();
    const item = await waitForItem();
    if (item) item.click();
    else {
      console.warn("Refresh now: GitHub's menu item was not found");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  } finally {
    document.documentElement.removeAttribute(HIDING_ATTR);
  }
}

function syncLoading(): void {
  if (!button) return;
  button.setAttribute("aria-disabled", String(loading));
  button.toggleAttribute("data-loading", loading);
  button.setAttribute("data-gha-tooltip", loading ? "Refreshing…" : "Refresh now");
}

function finishLoading(): void {
  loading = false;
  clearTimeout(loadingTimer);
  contentWatcher?.disconnect();
  contentWatcher = null;
  syncLoading();
}

function startLoading(): void {
  loading = true;
  const started = Date.now();
  loadingTimer = window.setTimeout(finishLoading, COOLDOWN_MS);
  contentWatcher = new MutationObserver((records) => {
    if (records.some((record) => isContentUpdate(record.target, started, Date.now()))) finishLoading();
  });
  contentWatcher.observe(document.body, { childList: true, subtree: true, characterData: true });
  syncLoading();
}

function createButton(): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = BUTTON_CLASS;
  element.setAttribute("aria-label", "Refresh now");
  element.setAttribute("data-gha-tooltip-direction", "n");
  element.append(createIcon("sync"));
  element.addEventListener("click", () => {
    const trigger = findTrigger();
    if (!trigger || loading) return;
    startLoading();
    void refresh(trigger);
  });
  return element;
}

// Idempotent: GitHub re-renders its toolbar, so the button is re-attached whenever it is missing
// or no longer right after the trigger.
function update(): void {
  const trigger = findTrigger();
  if (!trigger) {
    button?.remove();
    return;
  }
  button ??= createButton();
  if (trigger.nextElementSibling !== button) trigger.after(button);
  syncLoading();
}

installTooltips();
createPageScheduler({
  update,
  idle: true,
  observe: { childList: true, subtree: true },
  events: ["turbo:load", "popstate", "pageshow"],
}).start();
