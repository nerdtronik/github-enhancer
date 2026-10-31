import { expect, test } from "@rstest/core";
import { nameOf } from "../src/ts/features/workflow-categories/name";

const link = (html: string) => {
  const element = document.createElement("a");
  element.innerHTML = html;
  return element;
};

test("nameOf returns the plain label", () => {
  expect(nameOf(link("  deploy-prod "))).toBe("deploy-prod");
});

test("nameOf ignores text that other extensions append to the label", () => {
  expect(nameOf(link("nightly <em>(<relative-time>in 3 hours</relative-time>)</em>"))).toBe("nightly");
  expect(nameOf(link('ci <span data-gha-ignore>extra</span>'))).toBe("ci");
});
