/**
 * Pure DOM helpers for the "Refresh now" shortcut. GitHub's hashed class names change often, so
 * everything is matched by role, label and icon instead.
 */

export const COOLDOWN_MS = 5000;
export const BUTTON_CLASS = "gha-refresh-now";

function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  const referenced = labelledBy
    ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
    : "";
  return (element.getAttribute("aria-label") ?? (referenced || element.textContent) ?? "").trim();
}

/** The dropdown button of GitHub's auto-refresh menu: a menu button named "...refresh..." or with a sync icon. */
export function findTrigger(root: ParentNode = document): HTMLButtonElement | null {
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]")) {
    if (button.classList.contains(BUTTON_CLASS) || button.closest(`.${BUTTON_CLASS}`)) continue;
    if (/refresh/i.test(accessibleName(button)) || button.querySelector(".octicon-sync")) return button;
  }
  return null;
}

/** The "Refresh now" entry of the opened menu, or null while the menu is not rendered. */
export function findRefreshItem(root: ParentNode = document): HTMLElement | null {
  for (const item of root.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    if (/^refresh now$/i.test(accessibleName(item))) return item;
  return null;
}

export const MIN_LOADING_MS = 800;

const OWN_CONTENT = `.${BUTTON_CLASS}, .gha-tooltip, #__primerPortalRoot__, [class*="gha-"]`;

/**
 * True when a DOM mutation looks like the refreshed content arriving: it happened at least
 * MIN_LOADING_MS after the click and is not our own UI or GitHub's menu popup closing.
 */
export function isContentUpdate(target: Node, started: number, now: number): boolean {
  if (now - started < MIN_LOADING_MS) return false;
  const element = target instanceof Element ? target : target.parentElement;
  return !!element && !element.closest(OWN_CONTENT);
}
