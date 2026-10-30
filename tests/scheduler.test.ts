import { afterEach, beforeEach, expect, test } from "@rstest/core";
import { createPageScheduler } from "../src/ts/core/scheduler";

let frames: FrameRequestCallback[] = [];
const realFrame = globalThis.requestAnimationFrame;

beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
});

afterEach(() => {
  globalThis.requestAnimationFrame = realFrame;
});

const flush = () => {
  const pending = frames;
  frames = [];
  pending.forEach((callback) => callback(0));
};

test("coalesces schedule calls into one update per frame", () => {
  let calls = 0;
  const scheduler = createPageScheduler({ update: () => calls++ });
  scheduler.start();
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  expect(frames.length).toBe(1);
  flush();
  expect(calls).toBe(1);
  scheduler.stop();
});

test("does not update before start", () => {
  let calls = 0;
  const scheduler = createPageScheduler({ update: () => calls++ });
  scheduler.schedule();
  flush();
  expect(calls).toBe(0);
});

test("ignores mutations that are not relevant", async () => {
  let calls = 0;
  const scheduler = createPageScheduler({
    update: () => calls++,
    relevant: () => false,
    observe: { childList: true, subtree: true },
  });
  scheduler.start();
  document.body.append(document.createElement("div"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  flush();
  expect(calls).toBe(0);
  scheduler.stop();
});

test("schedules on relevant mutations", async () => {
  let calls = 0;
  const scheduler = createPageScheduler({
    update: () => calls++,
    observe: { childList: true, subtree: true },
  });
  scheduler.start();
  document.body.append(document.createElement("div"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  flush();
  expect(calls).toBe(1);
  scheduler.stop();
});

test("stop removes event listeners", () => {
  let calls = 0;
  const scheduler = createPageScheduler({ update: () => calls++, events: ["turbo:load"] });
  scheduler.start();
  document.dispatchEvent(new Event("turbo:load"));
  flush();
  expect(calls).toBe(1);
  scheduler.stop();
  document.dispatchEvent(new Event("turbo:load"));
  flush();
  expect(calls).toBe(1);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("inactive scheduler ignores mutations and scroll", async () => {
  let calls = 0;
  const scheduler = createPageScheduler({
    update: () => calls++,
    active: () => false,
    observe: { childList: true, subtree: true },
    events: ["scroll", "turbo:load"],
  });
  scheduler.start();
  document.body.append(document.createElement("div"));
  window.dispatchEvent(new Event("scroll"));
  scheduler.schedule();
  await settle();
  flush();
  expect(calls).toBe(0);
  scheduler.stop();
});

test("becoming active on turbo:load updates once", () => {
  let calls = 0;
  let on = false;
  const scheduler = createPageScheduler({
    update: () => calls++,
    active: () => on,
    events: ["scroll", "turbo:load"],
  });
  scheduler.start();
  on = true;
  document.dispatchEvent(new Event("turbo:load"));
  flush();
  expect(calls).toBe(1);
  window.dispatchEvent(new Event("scroll"));
  flush();
  expect(calls).toBe(2);
  scheduler.stop();
});

test("becoming inactive disconnects the observer", async () => {
  let calls = 0;
  let on = true;
  const scheduler = createPageScheduler({
    update: () => calls++,
    active: () => on,
    observe: { childList: true, subtree: true },
    events: ["scroll"],
  });
  scheduler.start();
  on = false;
  document.dispatchEvent(new Event("turbo:load"));
  document.body.append(document.createElement("div"));
  window.dispatchEvent(new Event("scroll"));
  await settle();
  flush();
  expect(calls).toBe(0);
  scheduler.stop();
});

test("stop after activation removes listeners", async () => {
  let calls = 0;
  let on = false;
  const scheduler = createPageScheduler({
    update: () => calls++,
    active: () => on,
    observe: { childList: true, subtree: true },
    events: ["scroll", "turbo:load"],
  });
  scheduler.start();
  on = true;
  document.dispatchEvent(new Event("turbo:load"));
  flush();
  scheduler.stop();
  const before = calls;
  document.body.append(document.createElement("div"));
  window.dispatchEvent(new Event("scroll"));
  document.dispatchEvent(new Event("turbo:load"));
  await settle();
  flush();
  expect(calls).toBe(before);
});

test("reattach cycle does not double-fire or leak", async () => {
  let calls = 0;
  let on = true;
  const scheduler = createPageScheduler({
    update: () => calls++,
    active: () => on,
    observe: { childList: true, subtree: true },
  });
  scheduler.start();
  on = false;
  document.dispatchEvent(new Event("turbo:load"));
  on = true;
  document.dispatchEvent(new Event("turbo:load"));
  flush();
  expect(calls).toBe(1);
  document.body.append(document.createElement("div"));
  await settle();
  flush();
  expect(calls).toBe(2);
  scheduler.stop();
});

test("idle inactive start updates only after idle activation", async () => {
  let calls = 0;
  let on = false;
  const realIdle = window.requestIdleCallback;
  const idle: (() => void)[] = [];
  window.requestIdleCallback = ((callback: () => void) => idle.push(callback)) as never;
  Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
  const scheduler = createPageScheduler({ update: () => calls++, idle: true, active: () => on });
  scheduler.start();
  on = true;
  document.dispatchEvent(new Event("turbo:load"));
  flush();
  expect(calls).toBe(0);
  idle.forEach((callback) => callback());
  expect(calls).toBe(1);
  scheduler.stop();
  window.requestIdleCallback = realIdle;
  delete (document as { readyState?: string }).readyState;
});

test("post-update re-evaluation detaches after a cleanup update", async () => {
  let calls = 0;
  let on = true;
  const scheduler = createPageScheduler({
    update: () => {
      calls++;
      on = false;
    },
    active: () => on,
    observe: { childList: true, subtree: true },
  });
  scheduler.start();
  scheduler.schedule();
  flush();
  expect(calls).toBe(1);
  document.body.append(document.createElement("div"));
  await settle();
  flush();
  expect(calls).toBe(1);
  scheduler.stop();
});

test("path watcher activates an inactive scheduler on title change", async () => {
  let calls = 0;
  const scheduler = createPageScheduler({
    update: () => calls++,
    active: () => location.pathname === "/watched",
  });
  scheduler.start();
  history.pushState({}, "", "/watched");
  document.head.append(document.createElement("title"));
  await settle();
  flush();
  expect(calls).toBe(1);
  scheduler.stop();
  history.pushState({}, "", "/");
});
