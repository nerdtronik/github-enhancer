/**
 * Drag/keyboard resize handles for the Actions list, run jobs list and PR files sidebars; widths
 * persist per sidebar type through the store.
 */
import { DEFAULTS } from "../../core/defaults";
import { createPageScheduler } from "../../core/scheduler";
import { route } from "../../core/routes";
import { store } from "../../core/settings";

type SidebarType = "actions" | "actions-run" | "pull-files";
type Rect = Pick<DOMRect, "left" | "right" | "width" | "top" | "bottom">;

const MIN_WIDTH = DEFAULTS.SIDEBAR_MIN_WIDTH;
const KEYBOARD_STEP = 20;

const widths = new Map<SidebarType, number>();
let current: SidebarResizer | undefined;
const write = store.writer((error) => storageFailure("save", error));
let invalidated = false;

// Upper bound is the lesser of the global max and what leaves SIDEBAR_MIN_CONTENT_WIDTH (360px)
// for the content; it never drops below MIN_WIDTH even on narrow windows.
const maxWidth = () =>
  Math.max(
    MIN_WIDTH,
    Math.min(DEFAULTS.SIDEBAR_MAX_WIDTH, window.innerWidth - DEFAULTS.SIDEBAR_MIN_CONTENT_WIDTH),
  );
const clamp = (width: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));

// Which sidebar the current route has: the Actions workflow list, a run's jobs list, or PR files.
function sidebarPage(): SidebarType | null {
  const current = route();
  if (current.kind === "pullFiles") return "pull-files";
  if (current.kind === "actionRun") return "actions-run";
  if (current.kind !== "actions") return null;
  return /^\/runs\/[^/]+/.test(current.rest) ? "actions-run" : "actions";
}

// target gets the width CSS variable; pane is the element measured for the handle. The Actions
// list is itself the aside; the others use the PageLayout pane inside a split-page-layout.
function findSidebar(type: SidebarType): { target: HTMLElement; pane: HTMLElement } | null {
  if (type === "actions") {
    const target = document.querySelector<HTMLElement>(
      'aside[aria-label="Actions"][data-expanded="true"]:has(nav[aria-label="Actions workflows"])',
    );
    return target && { target, pane: target };
  }
  const target = document.querySelector<HTMLElement>(
    type === "actions-run"
      ? 'split-page-layout:has(react-partial[partial-name="actions-run-jobs-list"])'
      : "split-page-layout",
  );
  const pane = target?.querySelector<HTMLElement>(".PageLayout-pane");
  return target && pane ? { target, pane } : null;
}

function storageFailure(action: string, error: unknown): void {
  // This message means the extension was reloaded or updated and orphaned this script: detach
  // and stop instead of warning on every later call.
  if ((error as Error)?.message?.includes("Extension context invalidated")) {
    invalidated = true;
    current?.detach();
    return;
  }
  console.warn(`Could not ${action} sidebar width`, error);
}

class SidebarResizer {
  private readonly handle = document.createElement("div");
  private readonly events = new AbortController();
  private readonly observer = new ResizeObserver(() => this.position());
  private rect: Rect | undefined;
  private width: number | undefined;

  constructor(
    readonly type: SidebarType,
    readonly target: HTMLElement,
    readonly pane: HTMLElement,
  ) {
    this.setupHandle();
    this.bindDrag();
    this.observer.observe(pane);
    const { signal } = this.events;
    window.addEventListener("resize", () => this.onResize(), { signal });
    window.addEventListener("scroll", () => this.position(), { passive: true, signal });
    this.restore();
  }

  get isConnected(): boolean {
    return this.handle.isConnected;
  }

  get ownHandle(): HTMLElement {
    return this.handle;
  }

  detach(): void {
    this.target.style.removeProperty("--gha-sidebar-width");
    this.target.removeAttribute("data-gha-sidebar-sized");
    this.handle.remove();
    this.observer.disconnect();
    this.events.abort();
    document.documentElement.classList.remove("gha-sidebar-resizing");
    if (current === this) current = undefined;
  }

  private setupHandle(): void {
    const { handle } = this;
    // The handle is appended to body and placed with position: fixed from the pane's rect, so it
    // does not depend on GitHub's sidebar markup; position() keeps it aligned on scroll/resize.
    handle.className = "gha-sidebar-resize-handle";
    if (this.type === "actions") handle.classList.add("gha-sidebar-resize-line");
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize left sidebar");
    handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    handle.tabIndex = 0;
    handle.hidden = true;
    document.body.append(handle);
  }

  private bindDrag(): void {
    const { handle } = this;
    const options = { signal: this.events.signal };
    let drag: { id: number; x: number; width: number } | undefined;

    const finish = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = undefined;
      document.documentElement.classList.remove("gha-sidebar-resizing");
      if (this.width !== undefined) this.save();
    };

    handle.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        const rect = this.pane.getBoundingClientRect();
        this.position(rect);
        drag = { id: event.pointerId, x: event.clientX, width: rect.width };
        handle.setPointerCapture?.(event.pointerId);
        document.documentElement.classList.add("gha-sidebar-resizing");
        event.preventDefault();
      },
      options,
    );
    handle.addEventListener(
      "pointermove",
      (event) => {
        if (drag && event.pointerId === drag.id)
          this.applyWidth(drag.width + event.clientX - drag.x);
      },
      options,
    );
    handle.addEventListener("pointerup", finish, options);
    handle.addEventListener("pointercancel", finish, options);
    handle.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        this.position();
        const width = this.width ?? this.rect!.width;
        this.applyWidth(width + (event.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP));
        this.save();
        event.preventDefault();
      },
      options,
    );
  }

  private restore(): void {
    const cached = widths.get(this.type);
    if (cached !== undefined) {
      this.applyWidth(cached);
      return;
    }
    store
      .read<number>("sidebarWidth", this.type)
      .then((width) => {
        // Stored data is validated before use; if a drag or save set a width while the read was
        // pending, that newer value wins (the widths.has check).
        if (width === undefined || !Number.isSafeInteger(width) || width < MIN_WIDTH || width > DEFAULTS.SIDEBAR_MAX_WIDTH)
          return;
        if (widths.has(this.type)) return;
        widths.set(this.type, width);
        if (current === this && this.width === undefined) this.applyWidth(width);
      })
      .catch((error) => storageFailure("load", error));
  }

  private onResize(): void {
    const width = widths.get(this.type) ?? this.width;
    if (width !== undefined) this.applyWidth(width);
    this.position();
  }

  private position(rect: Rect = this.pane.getBoundingClientRect()): void {
    this.rect = rect;
    const { handle } = this;
    const isActions = this.type === "actions";
    const top = isActions ? Math.max(0, rect.top) : 0;
    const bottom = isActions ? Math.min(window.innerHeight, rect.bottom) : 0;
    handle.hidden = rect.width === 0 || (isActions && bottom <= top);
    // The handle is 10px wide, so right - 5 centres it on the pane's right edge.
    if (!handle.hidden) handle.style.left = `${rect.right - 5}px`;
    if (isActions) {
      handle.style.top = `${top}px`;
      handle.style.height = `${Math.max(0, bottom - top)}px`;
    }
    handle.setAttribute("aria-valuemax", String(maxWidth()));
    handle.setAttribute("aria-valuenow", String(Math.round(rect.width)));
  }

  private applyWidth(width: number): void {
    this.width = clamp(width);
    this.target.style.setProperty("--gha-sidebar-width", `${this.width}px`);
    this.target.setAttribute("data-gha-sidebar-sized", "");
    // The pane has not reflowed yet, so position the handle from the predicted rect.
    const { rect } = this;
    if (rect)
      this.position({
        left: rect.left,
        right: rect.left + this.width,
        width: this.width,
        top: rect.top,
        bottom: rect.bottom,
      });
  }

  private save(): void {
    if (this.width === undefined) return;
    widths.set(this.type, this.width);
    const width = this.width;
    void write("sidebarWidth", this.type, width);
  }
}

function update(): void {
  if (invalidated) return;
  // Narrow windows (< 800px) get no handle; the checks below detach any existing one.
  const type = window.innerWidth >= 800 ? sidebarPage() : null;
  const sidebar = type && findSidebar(type);
  if (
    current &&
    (current.type !== type ||
      current.target !== sidebar?.target ||
      current.pane !== sidebar?.pane ||
      !current.isConnected)
  )
    current.detach();
  for (const handle of document.querySelectorAll(".gha-sidebar-resize-handle"))
    if (handle !== current?.ownHandle) handle.remove();
  if (type && sidebar && !current)
    current = new SidebarResizer(type, sidebar.target, sidebar.pane);
}

createPageScheduler({
  update,
  active: () => Boolean(current || sidebarPage()),
  relevant: () => Boolean(current || sidebarPage()),
  observe: {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-expanded"],
  },
  events: ["turbo:load", "popstate", "resize"],
}).start();
update();
