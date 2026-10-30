import { expect, test } from "@rstest/core";
import {
  contrast,
  formatColor,
  mix,
  parseColor,
  withAlpha,
} from "../src/ts/features/themes/color";

test("parseColor accepts hex forms only", () => {
  expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  expect(parseColor("#50FA7B26")?.a).toBeCloseTo(0.149, 3);
  expect(parseColor("red")).toBeNull();
  expect(parseColor("#12345")).toBeNull();
  expect(parseColor("#gggggg")).toBeNull();
  expect(parseColor("#fff; x")).toBeNull();
});

test("formatColor round-trips", () => {
  expect(formatColor(parseColor("#282a36")!)).toBe("#282a36");
});

test("mix and withAlpha", () => {
  expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
  expect(withAlpha("#50fa7b", 0.15)).toBe("#50fa7b26");
});

test("contrast follows WCAG", () => {
  expect(contrast("#ffffff", "#000000")).toBe(21);
  expect(contrast("#f8f8f2", "#282a36")).toBeGreaterThanOrEqual(13);
  expect(Math.abs(contrast("#6272a4", "#282a36") - 3.03)).toBeLessThan(0.05);
});
