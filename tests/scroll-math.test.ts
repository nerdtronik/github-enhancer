import { expect, test } from "@rstest/core";
import {
  computeMax,
  dragScroll,
  nextArrowTarget,
  thumbWidth,
} from "../src/ts/features/run-view/scrollMath";

test("computeMax is 0 without visible stages", () => {
  expect(computeMax({ scrollWidth: 1000, clientWidth: 400, contentRight: null })).toBe(0);
});

test("computeMax stops at the last visible stage plus its trailing padding", () => {
  expect(computeMax({ scrollWidth: 2000, clientWidth: 400, contentRight: 532 })).toBe(132);
});

test("computeMax never exceeds the real scrollable width", () => {
  expect(computeMax({ scrollWidth: 450, clientWidth: 400, contentRight: 532 })).toBe(50);
  expect(computeMax({ scrollWidth: 300, clientWidth: 400, contentRight: Infinity })).toBe(0);
});

test("computeMax falls back to the scrollable width for an unmeasured last stage", () => {
  expect(computeMax({ scrollWidth: 1000, clientWidth: 400, contentRight: Infinity })).toBe(600);
});

test("computeMax is 0 when the content fits", () => {
  expect(computeMax({ scrollWidth: 2000, clientWidth: 400, contentRight: 300 })).toBe(0);
});

test("thumbWidth has a 64px minimum", () => {
  expect(thumbWidth({ trackWidth: 100, clientWidth: 400, max: 600 })).toBe(64);
});

test("thumbWidth scales with the visible ratio and never exceeds the track", () => {
  expect(thumbWidth({ trackWidth: 500, clientWidth: 400, max: 200 })).toBe(286);
  expect(thumbWidth({ trackWidth: 50, clientWidth: 400, max: 600 })).toBe(50);
});

test("dragScroll maps pointer travel to scroll distance", () => {
  expect(dragScroll({ startScroll: 100, deltaX: 50, travel: 100, max: 600 })).toBe(400);
});

test("dragScroll clamps and rounds", () => {
  expect(dragScroll({ startScroll: 100, deltaX: -50, travel: 100, max: 600 })).toBe(0);
  expect(dragScroll({ startScroll: 500, deltaX: 50, travel: 100, max: 600 })).toBe(600);
  expect(dragScroll({ startScroll: 0, deltaX: 1, travel: 3, max: 10 })).toBe(3);
});
