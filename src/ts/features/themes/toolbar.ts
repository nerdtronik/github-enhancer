/**
 * The Custom themes toolbar (new, import, export) and its status line; remounting only re-points
 * its actions.
 */
import type { ThemeMode } from "./theme";

export interface ToolbarActions {
  create(mode: ThemeMode): void;
  importFile(): void;
  exportAll(): void;
}

/**
 * A form id that matches no element. Controls pointing at it via the `form` attribute belong to no
 * form, so GitHub's appearance form cannot submit or serialize them.
 */
export const DETACHED_FORM = "gha-themes-detached";
const SELECTOR = "[data-gha-themes-toolbar]";
// Buttons call through this, so a remount can swap the actions without rebuilding them.
let current: ToolbarActions | undefined;

function button(text: string, run: () => void) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "btn btn-sm";
  node.setAttribute("form", DETACHED_FORM);
  node.textContent = text;
  // Stop the click here as well, in case GitHub handles clicks on this page by delegation.
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    run();
  });
  return node;
}

function createToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "d-flex flex-wrap flex-items-center mb-3";
  toolbar.setAttribute("data-gha-themes-toolbar", "");
  const notice = document.createElement("span");
  notice.className = "text-small color-fg-muted";
  notice.setAttribute("role", "status");
  toolbar.append(
    button("New dark theme", () => current?.create("dark")),
    button("New light theme", () => current?.create("light")),
    button("Import", () => current?.importFile()),
    button("Export", () => current?.exportAll()),
    notice,
  );
  return toolbar;
}

/** Puts the toolbar right before `before`; without `actions` it removes the toolbar. */
export function mountToolbar(before: Element, actions: ToolbarActions | undefined): void {
  current = actions;
  const container = before.parentElement!;
  const toolbar = container.querySelector(`:scope > ${SELECTOR}`);
  if (!actions) {
    toolbar?.remove();
    return;
  }
  // Already in place: keep the existing buttons and the status text.
  if (toolbar?.nextElementSibling === before) return;
  toolbar?.remove();
  before.before(createToolbar());
}

/** Shows `message` in the toolbar status line; does nothing when the toolbar is not mounted. */
export function showNotice(message: string, kind: "info" | "error"): void {
  const notice = document.querySelector(`${SELECTOR} [role="status"]`);
  if (!notice) return;
  notice.textContent = message;
  notice.classList.toggle("color-fg-danger", kind === "error");
  notice.classList.toggle("color-fg-muted", kind !== "error");
}
