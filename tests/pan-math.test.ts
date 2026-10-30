import { expect, test } from "@rstest/core";
import {
  inertiaStep,
  panTarget,
  releaseVelocity,
} from "../src/ts/features/run-view/scrollMath";

test("panTarget moves opposite to the pointer and clamps to the range", () => {
  expect(panTarget({ start: 100, pointerStart: 500, pointer: 450, max: 600 })).toBe(150);
  expect(panTarget({ start: 100, pointerStart: 500, pointer: 560, max: 600 })).toBe(40);
  expect(panTarget({ start: 100, pointerStart: 500, pointer: 900, max: 600 })).toBe(0);
  expect(panTarget({ start: 100, pointerStart: 500, pointer: 0, max: 600 })).toBe(600);
  expect(panTarget({ start: 0, pointerStart: 0, pointer: -50, max: 0 })).toBe(0);
});

test("releaseVelocity is px/ms over the recent window only", () => {
  const samples = [
    { t: 0, x: 0 },
    { t: 400, x: 100 },
    { t: 450, x: 150 },
    { t: 500, x: 250 },
  ];
  expect(releaseVelocity(samples, 500, 100)).toBeCloseTo(1.5, 5);
  expect(releaseVelocity(samples, 500, 1000)).toBeCloseTo(0.5, 5);
});

test("releaseVelocity is 0 for a single sample, a stale pause or no time span", () => {
  expect(releaseVelocity([], 100)).toBe(0);
  expect(releaseVelocity([{ t: 10, x: 5 }], 10)).toBe(0);
  expect(releaseVelocity([{ t: 0, x: 0 }, { t: 10, x: 50 }], 400, 100)).toBe(0);
  expect(releaseVelocity([{ t: 10, x: 0 }, { t: 10, x: 50 }], 10, 100)).toBe(0);
});

test("inertiaStep decays velocity exponentially and integrates distance", () => {
  const step = inertiaStep({ position: 100, velocity: 1, dt: 250, max: 1000, tau: 250 });
  expect(step.velocity).toBeCloseTo(Math.exp(-1), 5);
  expect(step.position).toBeCloseTo(100 + 250 * (1 - Math.exp(-1)), 5);
  expect(step.done).toBe(false);
});

test("inertiaStep stops at the bounds and when too slow", () => {
  expect(inertiaStep({ position: 990, velocity: 2, dt: 100, max: 1000, tau: 250 })).toEqual({
    position: 1000,
    velocity: 0,
    done: true,
  });
  expect(inertiaStep({ position: 10, velocity: -2, dt: 100, max: 1000, tau: 250 })).toEqual({
    position: 0,
    velocity: 0,
    done: true,
  });
  const slow = inertiaStep({ position: 50, velocity: 0.021, dt: 1000, max: 1000, tau: 250 });
  expect(slow.done).toBe(true);
});
