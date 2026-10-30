/** Click-and-drag panning of the job canvas, with release glide. Returns a disposer. */
import { inertiaStep, panTarget, releaseVelocity } from "./scrollMath";

// Pointer must move this many px before a press becomes a drag, so plain clicks still work.
const DRAG_THRESHOLD = 4;
const INERTIA_TAU = 250;
const SAMPLE_WINDOW = 100;
const PANNING_CLASS = "gha-run-panning";
// Presses on these must keep native behavior (text selection, caret), so they never start a pan.
const FORM_CONTROLS = "input, textarea, select, [contenteditable]";

interface PanOptions {
  getMaxX: () => number;
}

interface Gesture {
  id: number;
  touch: boolean;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
  maxX: number;
  maxY: number;
  dragging: boolean;
  samplesX: { t: number; x: number }[];
  samplesY: { t: number; x: number }[];
}

export function enablePanDrag(
  canvas: HTMLElement,
  { getMaxX }: PanOptions,
): () => void {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let gesture: Gesture | undefined;
  let pointerX = 0;
  let pointerY = 0;
  let frame = 0;
  let glide = 0;

  const maxY = () => Math.max(0, canvas.scrollHeight - canvas.clientHeight);

  const stopGlide = () => {
    if (glide) cancelAnimationFrame(glide);
    glide = 0;
  };

  // Runs from requestAnimationFrame: pointer moves only record the position, so scroll is written
  // at most once per frame. Touch pans horizontally only; vertical scroll stays native.
  const apply = () => {
    frame = 0;
    if (!gesture?.dragging) return;
    const { startX, startY, scrollLeft, scrollTop, maxX, maxY: limitY, touch } = gesture;
    canvas.scrollLeft = panTarget({ start: scrollLeft, pointerStart: startX, pointer: pointerX, max: maxX });
    if (!touch)
      canvas.scrollTop = panTarget({ start: scrollTop, pointerStart: startY, pointer: pointerY, max: limitY });
  };

  // A drag ends in a click on whatever is under the pointer; cancel it so panning does not open
  // links or toggle cards.
  const swallowClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const glideFrom = (velocityX: number, velocityY: number) => {
    let vx = velocityX;
    let vy = velocityY;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      const x = inertiaStep({ position: canvas.scrollLeft, velocity: vx, dt, max: getMaxX(), tau: INERTIA_TAU });
      const y = inertiaStep({ position: canvas.scrollTop, velocity: vy, dt, max: maxY(), tau: INERTIA_TAU });
      canvas.scrollLeft = x.position;
      canvas.scrollTop = y.position;
      vx = x.velocity;
      vy = y.velocity;
      glide = x.done && y.done ? 0 : requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };

  const finish = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const { dragging, touch, samplesX, samplesY } = gesture;
    gesture = undefined;
    if (!dragging) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    canvas.classList.remove(PANNING_CLASS);
    if (canvas.hasPointerCapture?.(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    // Swallow only the click that immediately follows this drag; the timeout removes the listener
    // if the browser fires no click (pointer released over another element).
    canvas.addEventListener("click", swallowClick, { capture: true, once: true });
    setTimeout(() => canvas.removeEventListener("click", swallowClick, true), 0);
    // No glide after a cancel or when the user prefers reduced motion.
    if (event.type === "pointercancel" || reducedMotion?.matches) return;
    const now = event.timeStamp;
    const vx = -releaseVelocity(samplesX, now, SAMPLE_WINDOW);
    const vy = touch ? 0 : -releaseVelocity(samplesY, now, SAMPLE_WINDOW);
    if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) glideFrom(vx, vy);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if ((event.target as Element).closest?.(FORM_CONTROLS)) return;
    stopGlide();
    const maxX = getMaxX();
    const limitY = maxY();
    if (maxX <= 0 && limitY <= 0) return;
    gesture = {
      id: event.pointerId,
      touch: event.pointerType === "touch",
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
      maxX,
      maxY: limitY,
      dragging: false,
      samplesX: [],
      samplesY: [],
    };
    pointerX = event.clientX;
    pointerY = event.clientY;
  };

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!gesture.dragging) {
      const moved = Math.hypot(pointerX - gesture.startX, pointerY - gesture.startY);
      if (moved < DRAG_THRESHOLD) return;
      gesture.dragging = true;
      // Capture only once the threshold is crossed so ordinary clicks keep their natural target.
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add(PANNING_CLASS);
    }
    gesture.samplesX.push({ t: event.timeStamp, x: pointerX });
    gesture.samplesY.push({ t: event.timeStamp, x: pointerY });
    if (gesture.samplesX.length > 8) {
      gesture.samplesX.shift();
      gesture.samplesY.shift();
    }
    if (!frame) frame = requestAnimationFrame(apply);
  };

  const interrupt = () => stopGlide();
  const keepSelectionOff = (event: Event) => {
    if (gesture?.dragging) event.preventDefault();
  };

  // Capture phase: runs before the canvas's descendants and ancestors (GitHub's graph) see the
  // events. pointermove and wheel are passive because we never cancel them. selectstart/dragstart
  // are cancelled only mid-drag to avoid selecting text or starting a native drag.
  const options = { capture: true };
  canvas.addEventListener("pointerdown", onDown, options);
  canvas.addEventListener("pointermove", onMove, { capture: true, passive: true });
  canvas.addEventListener("pointerup", finish, options);
  canvas.addEventListener("pointercancel", finish, options);
  canvas.addEventListener("lostpointercapture", finish, options);
  canvas.addEventListener("wheel", interrupt, { capture: true, passive: true });
  canvas.addEventListener("selectstart", keepSelectionOff, options);
  canvas.addEventListener("dragstart", keepSelectionOff, options);

  return () => {
    stopGlide();
    if (frame) cancelAnimationFrame(frame);
    gesture = undefined;
    canvas.classList.remove(PANNING_CLASS);
    canvas.removeEventListener("pointerdown", onDown, options);
    canvas.removeEventListener("pointermove", onMove, options);
    canvas.removeEventListener("pointerup", finish, options);
    canvas.removeEventListener("pointercancel", finish, options);
    canvas.removeEventListener("lostpointercapture", finish, options);
    canvas.removeEventListener("wheel", interrupt, options);
    canvas.removeEventListener("selectstart", keepSelectionOff, options);
    canvas.removeEventListener("dragstart", keepSelectionOff, options);
    canvas.removeEventListener("click", swallowClick, true);
  };
}
