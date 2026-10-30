/** Per-graph toolbar: scrollbar, arrows, search/filter, settings, hover scope and canvas input. */
import { settings } from "../../core/settings";
import { createJobFilter } from "./jobFilter";
import { enablePanDrag } from "./panDrag";
import { addHoverHighlights } from "./relationships";
import { applySavedHeight, createResizeHandle } from "./resizeHandle";
import {
  computeMax,
  dragScroll,
  nextArrowTarget,
  thumbWidth,
} from "./scrollMath";
import { createSettingsPanel } from "./settingsPanel";
import { createListeners, scheduleUpdate, state } from "./shared";

const { scrollbars } = state;

// Right edge of the last visible stage in canvas scroll coordinates, plus the stages container's
// trailing padding, so the scroll range ends with the same breathing room as the layout.
function lastStageRight(
  canvas: HTMLElement,
  stages: HTMLElement,
  last: HTMLElement,
): number {
  const origin = canvas.getBoundingClientRect().left + canvas.clientLeft;
  const trailing = parseFloat(getComputedStyle(stages).paddingInlineEnd) || 0;
  return last.getBoundingClientRect().right - origin + canvas.scrollLeft + trailing;
}

/** Adds a floating scrollbar with search/filter controls and settings UI. */
export function addScrollbar(
  graph: HTMLElement,
  canvas: HTMLCanvasElement,
  stages: HTMLElement,
): void {
  const { listen, dispose: removeListeners } = createListeners();


  // Turbo snapshots copy the toolbar without its event listeners or bindings.
  for (const stale of graph.querySelectorAll(
    ".gha-run-scrollbar, .gha-run-resize-handle",
  ))
    stale.remove();
  const staleFrame = canvas.closest(".gha-run-canvas-frame");
  if (staleFrame) staleFrame.replaceWith(canvas);
  canvas.setAttribute("role", "region");
  canvas.setAttribute("aria-label", "Workflow jobs, scroll horizontally");
  canvas.tabIndex = 0;
  applySavedHeight(canvas);

  const bar = document.createElement("div");
  bar.className = "gha-run-scrollbar";
  const controls = document.createElement("div");
  controls.className = "gha-run-controls";

  const jobFilter = createJobFilter({ graph, canvas, controls, bar });
  controls.append(jobFilter.element);

  const settingsPanel = createSettingsPanel();
  controls.append(settingsPanel.element);

  const syncSearchPosition = () => {
    const searchPosition = settings.get("actionRun_searchPosition");
    if (searchPosition === "left") {
      if (controls.lastElementChild !== jobFilter.element)
        controls.append(jobFilter.element);
    } else if (controls.firstElementChild !== jobFilter.element)
      controls.insertBefore(jobFilter.element, settingsPanel.element);
    jobFilter.place(searchPosition);
    controls.dataset.searchPosition = searchPosition;
    bar.dataset.searchPosition = searchPosition;
    settingsPanel.syncSearchPosition();
  };
  syncSearchPosition();

  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.step = "1";
  input.value = "0";
  input.setAttribute("aria-label", "Scroll workflow jobs horizontally");

  const header = document.createElement("div");
  header.className = "gha-run-scrollbar-header";

  const navigation = document.createElement("div");
  navigation.className = "gha-run-scroll-navigation";

  const resetScope = document.createElement("button");
  resetScope.type = "button";
  resetScope.className = "gha-run-scope-reset";
  resetScope.textContent = "Exit scoped view";
  resetScope.hidden = true;

  const arrows = new Map<number, HTMLButtonElement>();
  for (const direction of [-1, 1] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gha-run-scroll-arrow";
    button.dataset.direction = String(direction);
    button.setAttribute(
      "aria-label",
      `Scroll workflow jobs ${direction < 0 ? "left" : "right"}`,
    );

    const move = () => {
      const columns = stages.querySelectorAll<HTMLElement>(
        ":scope > .WorkflowStage:not([data-gha-status-hidden])",
      );
      if (!columns.length) return;
      const origin = columns[0].offsetLeft;
      canvas.scrollLeft = nextArrowTarget({
        direction,
        current: canvas.scrollLeft,
        max: Number(input.max),
        positions: Array.from(columns, (column) => column.offsetLeft - origin),
      });
      sync();
    };

    listen(button, "click", move);
    arrows.set(direction, button);
  }

  const syncArrowPlacement = () => {
    const arrowPlacement = settings.get("actionRun_arrowPlacement");
    const left = arrows.get(-1)!;
    const right = arrows.get(1)!;
    if (arrowPlacement === "right") header.replaceChildren(input, left, right);
    else if (arrowPlacement === "both")
      header.replaceChildren(left, input, right);
    else header.replaceChildren(left, right, input);
    settingsPanel.syncArrowPlacement();
  };
  syncArrowPlacement();

  navigation.append(resetScope, header);

  bar.append(controls, navigation, jobFilter.status);
  canvas.before(bar);

  const frame = document.createElement("div");
  frame.className = "gha-run-canvas-frame";
  canvas.before(frame);
  frame.append(canvas);

  const resizeHandle = createResizeHandle(canvas);
  frame.append(resizeHandle.element);

  const hover = addHoverHighlights(
    stages,
    (active: boolean) => {
      resetScope.hidden = !active;
      bar.classList.toggle("gha-run-scoped", active);
      if (active) canvas.scrollLeft = 0;
      scheduleUpdate();
    },
  );

  const syncHoverToggle = () => {
    settingsPanel.syncHover();
    hover.paint();
  };

  syncHoverToggle();

  const syncGroupingToggle = settingsPanel.syncGrouping;

  syncGroupingToggle();

  const exitScope = () => {
    hover.clearScope();
    canvas.focus({ preventScroll: true });
  };

  listen(resetScope, "click", exitScope);

  const sync = () => {
    input.value = String(canvas.scrollLeft);
    arrows.get(-1)!.disabled = canvas.scrollLeft <= 0;
    arrows.get(1)!.disabled = canvas.scrollLeft >= Number(input.max);
  };

  const refresh = () => {
    jobFilter.sync();

    const visibleStages = stages.querySelectorAll<HTMLElement>(
      ":scope > .WorkflowStage:not([data-gha-status-hidden]):not([data-gha-scope-hidden])",
    );
    const last = visibleStages[visibleStages.length - 1];
    // `contentRight` is null with no visible stage and Infinity while the last stage has no width
    // yet, so the range never relies on a stale measurement.
    const max = computeMax({
      scrollWidth: canvas.scrollWidth,
      clientWidth: canvas.clientWidth,
      contentRight: !last
        ? null
        : last.offsetWidth
          ? lastStageRight(canvas, stages, last)
          : Infinity,
    });
    input.max = String(max);
    input.disabled = max === 0;
    if (max > 0 && input.clientWidth > 0) {
      const width = thumbWidth({
        trackWidth: input.clientWidth,
        clientWidth: canvas.clientWidth,
        max,
      });
      input.style.setProperty("--gha-run-scroll-thumb-width", `${width}px`);
    }
    canvas.scrollLeft = Math.min(max, Math.max(0, canvas.scrollLeft));
    sync();
  };

  const scroll = () => {
    canvas.scrollLeft = Number(input.value);
    sync();
  };

  let drag:
    | {
        id: number;
        startX: number;
        scrollLeft: number;
        travel: number;
        max: number;
      }
    | undefined;

  const moveDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    canvas.scrollLeft = dragScroll({
      startScroll: drag.scrollLeft,
      deltaX: event.clientX - drag.startX,
      travel: drag.travel,
      max: drag.max,
    });
    sync();
    event.preventDefault();
  };

  // The range input's native thumb is restyled with a computed width; only presses on the thumb
  // start a drag, so clicking the track keeps the native jump behavior.
  const startDrag = (event: PointerEvent) => {
    if (input.disabled || event.button !== 0 || drag) return;
    const rect = input.getBoundingClientRect();
    const width = Math.min(
      rect.width,
      parseFloat(
        input.style.getPropertyValue("--gha-run-scroll-thumb-width"),
      ) || 64,
    );
    const travel = rect.width - width;
    if (travel <= 0) return;
    const thumbLeft =
      rect.left + (canvas.scrollLeft / Number(input.max)) * travel;
    if (event.clientX < thumbLeft || event.clientX > thumbLeft + width) return;
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      scrollLeft: canvas.scrollLeft,
      travel,
      max: Number(input.max),
    };
    input.setPointerCapture(event.pointerId);
    input.focus();
    event.preventDefault();
  };

  const stopDrag = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) drag = undefined;
  };

  const scrollWheel = (event: WheelEvent) => {
    if (!event.deltaX) return;
    canvas.scrollLeft = Math.min(
      Number(input.max),
      Math.max(0, canvas.scrollLeft + event.deltaX),
    );
    sync();
  };

  const scrollKeys = (event: KeyboardEvent) => {
    if (
      event.target !== canvas ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
      input.disabled
    )
      return;
    canvas.scrollLeft = Math.min(
      Number(input.max),
      Math.max(0, canvas.scrollLeft + (event.key === "ArrowLeft" ? -40 : 40)),
    );
    sync();
    event.preventDefault();
  };

  // Assumes GitHub's graph pan/zoom handlers listen on the canvas or its ancestors; this keeps them
  // from firing on our canvas. Registered in the capture phase so it runs first; keydown is stopped
  // only for arrow keys, leaving Tab and others alone.
  const stopCanvasInput = (event: Event) => {
    if (
      event.type !== "keydown" ||
      (event as KeyboardEvent).key.startsWith("Arrow")
    )
      event.stopPropagation();
  };

  const canvasEvents = [
    "wheel",
    "pointerdown",
    "pointermove",
    "selectstart",
    "dragstart",
    "keydown",
  ] as const;
  for (const type of canvasEvents) {
    listen(canvas, type, stopCanvasInput, { capture: true });
  }

  // The toolbar sits inside the graph element: stop its pointer, wheel and key events from
  // bubbling to GitHub's graph handlers.
  const stopGraphInput = (event: Event) => event.stopPropagation();
  for (const type of [
    "pointerdown",
    "pointermove",
    "wheel",
    "keydown",
  ] as const) {
    listen(bar, type, stopGraphInput);
  }

  listen(input, "pointerdown", startDrag);
  listen(input, "pointermove", moveDrag);
  listen(input, "pointerup", stopDrag);
  listen(input, "pointercancel", stopDrag);
  listen(input, "lostpointercapture", stopDrag);
  listen(input, "input", scroll);
  listen(canvas, "scroll", sync, { passive: true });
  // Passive: horizontal wheel only adds to scrollLeft and never needs preventDefault.
  listen(canvas, "wheel", scrollWheel, { capture: true, passive: true });
  listen(canvas, "keydown", scrollKeys, { capture: true });

  const disposePan = enablePanDrag(canvas, { getMaxX: () => Number(input.max) });

  const resizeObserver = new ResizeObserver(refresh);
  resizeObserver.observe(canvas);
  resizeObserver.observe(stages);
  resizeObserver.observe(input);

  scrollbars.set(graph, {
    canvas,
    stages,
    prepare: hover.refresh,
    refresh,
    updateCounts: jobFilter.updateCounts,
    syncHoverToggle,
    syncGroupingToggle,
    syncSearchPosition,
    syncArrowPlacement,
    remove() {
      hover.remove();
      jobFilter.dispose();
      settingsPanel.dispose();
      removeListeners();
      disposePan();
      resizeHandle.dispose();
      frame.replaceWith(...frame.childNodes);
      resizeObserver.disconnect();
      bar.remove();
    },
  });
}
