import { afterEach, beforeEach, expect, test } from "@rstest/core";
import { enablePanDrag } from "../src/ts/features/run-view/panDrag";

let canvas: HTMLElement;
let frames: FrameRequestCallback[] = [];
let dispose: () => void;
const flush = () => {
  const pending = frames;
  frames = [];
  pending.forEach((callback) => callback(performance.now()));
};

function pointer(type: string, init: Partial<PointerEventInit> & { clientX: number; clientY: number }) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, ...init });
}

beforeEach(() => {
  frames = [];
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as never;
  window.cancelAnimationFrame = (() => {}) as never;
  document.body.innerHTML = '<div id="canvas"><a id="link" href="#x">job</a><input id="field"></div>';
  canvas = document.getElementById("canvas")!;
  Object.defineProperty(canvas, "scrollHeight", { value: 500, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: 200, configurable: true });
  canvas.scrollLeft = 100;
  canvas.scrollTop = 50;
  dispose = enablePanDrag(canvas, { getMaxX: () => 600 });
});

afterEach(() => dispose());

test("a press below the drag threshold does not pan or block the click", () => {
  const link = document.getElementById("link")!;
  link.dispatchEvent(pointer("pointerdown", { clientX: 200, clientY: 100 }));
  link.dispatchEvent(pointer("pointermove", { clientX: 202, clientY: 101 }));
  link.dispatchEvent(pointer("pointerup", { clientX: 202, clientY: 101 }));
  flush();
  expect(canvas.scrollLeft).toBe(100);
  let clicked = false;
  link.addEventListener("click", () => (clicked = true));
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(clicked).toBe(true);
});

test("dragging pans both axes once per frame and marks the canvas as panning", () => {
  const link = document.getElementById("link")!;
  link.dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 100 }));
  link.dispatchEvent(pointer("pointermove", { clientX: 280, clientY: 90 }));
  link.dispatchEvent(pointer("pointermove", { clientX: 250, clientY: 70 }));
  expect(canvas.classList.contains("gha-run-panning")).toBe(true);
  expect(frames.length).toBe(1);
  flush();
  expect(canvas.scrollLeft).toBe(150);
  expect(canvas.scrollTop).toBe(80);
});

test("panning clamps to the scroll range", () => {
  const link = document.getElementById("link")!;
  link.dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 100 }));
  link.dispatchEvent(pointer("pointermove", { clientX: 900, clientY: 900 }));
  flush();
  expect(canvas.scrollLeft).toBe(0);
  expect(canvas.scrollTop).toBe(0);
  link.dispatchEvent(pointer("pointermove", { clientX: -900, clientY: -900 }));
  flush();
  expect(canvas.scrollLeft).toBe(600);
  expect(canvas.scrollTop).toBe(300);
});

test("a click right after a drag is swallowed once", () => {
  const link = document.getElementById("link")!;
  link.dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 100 }));
  link.dispatchEvent(pointer("pointermove", { clientX: 240, clientY: 100 }));
  link.dispatchEvent(pointer("pointerup", { clientX: 240, clientY: 100 }));
  expect(canvas.classList.contains("gha-run-panning")).toBe(false);
  let clicks = 0;
  link.addEventListener("click", () => clicks++);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(clicks).toBe(1);
});

test("form controls are not draggable and dispose stops panning", () => {
  const field = document.getElementById("field")!;
  field.dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 100 }));
  field.dispatchEvent(pointer("pointermove", { clientX: 200, clientY: 100 }));
  flush();
  expect(canvas.scrollLeft).toBe(100);
  dispose();
  const link = document.getElementById("link")!;
  link.dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 100 }));
  link.dispatchEvent(pointer("pointermove", { clientX: 200, clientY: 100 }));
  flush();
  expect(canvas.scrollLeft).toBe(100);
});

test("nothing pans when there is no scroll range", () => {
  dispose();
  Object.defineProperty(canvas, "scrollHeight", { value: 200, configurable: true });
  dispose = enablePanDrag(canvas, { getMaxX: () => 0 });
  const link = document.getElementById("link")!;
  link.dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 100 }));
  link.dispatchEvent(pointer("pointermove", { clientX: 200, clientY: 100 }));
  expect(canvas.classList.contains("gha-run-panning")).toBe(false);
});
