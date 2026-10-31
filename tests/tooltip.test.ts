import { expect, test } from "@rstest/core";
import { TOOLTIP_DELAY_MS, installTooltips } from "../src/ts/core/tooltip";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("shows a tooltip element in the body after a delay and hides it when the pointer leaves", async () => {
  installTooltips();
  installTooltips();
  document.body.innerHTML = `<button id="b" data-gha-tooltip="Add to category">+</button>`;
  const button = document.getElementById("b")!;
  button.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(document.querySelector(".gha-tooltip")).toBeNull();
  await wait(TOOLTIP_DELAY_MS + 60);
  const tip = document.querySelector<HTMLElement>(".gha-tooltip")!;
  expect(tip.parentElement).toBe(document.body);
  expect(tip.textContent).toBe("Add to category");
  expect(tip.hidden).toBe(false);
  button.dispatchEvent(new Event("pointerout", { bubbles: true }));
  expect(tip.hidden).toBe(true);
});

test("pressing the button dismisses it and it does not show before the delay", async () => {
  document.body.innerHTML = `<button id="b" data-gha-tooltip="Hi">x</button>`;
  const button = document.getElementById("b")!;
  button.dispatchEvent(new Event("pointerover", { bubbles: true }));
  button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  await wait(TOOLTIP_DELAY_MS + 60);
  expect(document.querySelector(".gha-tooltip:not([hidden])")).toBeNull();
});
