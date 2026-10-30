/** Keyboard- and pointer-operable handle that resizes the job canvas height and persists it. */
import { settings } from "../../core/settings";
import { createListeners, state } from "./shared";

export interface ResizeHandle {
  element: HTMLElement;
  dispose(): void;
}

export function applySavedHeight(canvas: HTMLElement): void {
  const savedHeight = settings.get("actionRun_jobsViewHeight");
  if (savedHeight !== null)
    canvas.style.setProperty("--gha-run-canvas-height", `${savedHeight}px`);
}

export function createResizeHandle(canvas: HTMLElement): ResizeHandle {
  const { listen, dispose: removeListeners } = createListeners();

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "gha-run-resize-handle";
  handle.setAttribute("aria-label", "Resize jobs view vertically");
  handle.title = "Drag or use arrow keys to resize jobs view";

  // 180px minimum. While dragging the value is only a draft in `state`; it is saved once on
  // release so each pixel does not write settings.
  const setHeight = (height: number) => {
    state.jobsViewHeight = Math.max(180, Math.round(height));
    canvas.style.setProperty(
      "--gha-run-canvas-height",
      `${state.jobsViewHeight}px`,
    );
  };

  const saveHeight = () => {
    const height = state.jobsViewHeight;
    state.jobsViewHeight = undefined;
    if (height !== undefined) void settings.set("actionRun_jobsViewHeight", height);
  };

  let drag: { id: number; startY: number; height: number } | undefined;
  // stopPropagation on the handle's pointer events keeps ancestor handlers (GitHub's graph) from
  // treating them as graph interaction.
  const start = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    drag = {
      id: event.pointerId,
      startY: event.clientY,
      height: canvas.getBoundingClientRect().height,
    };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const move = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    setHeight(drag.height + event.clientY - drag.startY);
    event.preventDefault();
    event.stopPropagation();
  };

  const stop = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    saveHeight();
    event.stopPropagation();
  };

  // Arrow keys are the accessible alternative to dragging: 40px per press, saved immediately.
  // stopPropagation keeps ancestor handlers (GitHub's graph) from also reacting.
  const keys = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    setHeight(
      (state.jobsViewHeight ??
        settings.get("actionRun_jobsViewHeight") ??
        canvas.getBoundingClientRect().height) +
        (event.key === "ArrowUp" ? -40 : 40),
    );
    saveHeight();
    event.preventDefault();
    event.stopPropagation();
  };

  listen(handle, "pointerdown", start);
  listen(handle, "pointermove", move);
  listen(handle, "pointerup", stop);
  listen(handle, "pointercancel", stop);
  listen(handle, "lostpointercapture", stop);
  listen(handle, "keydown", keys);

  return {
    element: handle,
    dispose() {
      removeListeners();
      handle.remove();
    },
  };
}
