/**
 * Primer-style tooltips for our icon buttons: any element with `data-gha-tooltip="text"` gets one.
 * The tooltip is a single element in the browser's top layer (popover), positioned with fixed
 * coordinates, so no ancestor's overflow or stacking context can clip it. Styles: `.gha-tooltip`
 * in content.css. `data-gha-tooltip-direction="n"` puts it above the element (default: below,
 * right-aligned to the element).
 */
import { shared } from "./settings";

export const TOOLTIP_DELAY_MS = 300;
const SELECTOR = "[data-gha-tooltip]";
const GAP = 4;
const MARGIN = 4;

type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

function createTooltips(): void {
  const tip = document.createElement("div") as PopoverElement;
  tip.className = "gha-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("popover", "manual");
  let current: Element | null = null;
  let timer = 0;

  const hide = () => {
    clearTimeout(timer);
    if (tip.isConnected) tip.hidePopover?.();
    tip.hidden = true;
  };

  const show = (target: Element) => {
    const text = target.getAttribute("data-gha-tooltip");
    if (!text || !target.isConnected) return;
    if (!tip.isConnected) document.body.append(tip);
    tip.textContent = text;
    tip.hidden = false;
    tip.showPopover?.();
    const anchor = target.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const above = target.getAttribute("data-gha-tooltip-direction") === "n";
    const top = above ? anchor.top - box.height - GAP : anchor.bottom + GAP;
    const left = above ? anchor.left + anchor.width / 2 - box.width / 2 : anchor.right - box.width;
    tip.style.top = `${Math.max(MARGIN, Math.min(top, window.innerHeight - box.height - MARGIN))}px`;
    tip.style.left = `${Math.max(MARGIN, Math.min(left, window.innerWidth - box.width - MARGIN))}px`;
  };

  const enter = (target: Element | null) => {
    if (target === current) return;
    hide();
    current = target;
    if (target) timer = window.setTimeout(() => show(target), TOOLTIP_DELAY_MS);
  };

  const find = (event: Event) => (event.target as Element | null)?.closest?.(SELECTOR) ?? null;
  document.addEventListener("pointerover", (event) => enter(find(event)));
  document.addEventListener("pointerout", (event) => {
    const next = (event as PointerEvent).relatedTarget as Element | null;
    if (current && !current.contains(next)) enter(null);
  });
  document.addEventListener("focusin", (event) => {
    const target = find(event);
    if (target?.matches(":focus-visible")) enter(target);
  });
  document.addEventListener("focusout", () => enter(null));
  // Clicking (opening a menu, starting an action) or scrolling dismisses it until the pointer re-enters.
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", hide, true);
  document.addEventListener("scroll", hide, true);
}

/** Installs the delegated listeners once per JS world, however many bundles call it. */
export function installTooltips(): void {
  shared("tooltips", () => {
    createTooltips();
    return true;
  });
}
