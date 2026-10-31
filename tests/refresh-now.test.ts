import { beforeEach, expect, test } from "@rstest/core";
import { MIN_LOADING_MS, findRefreshItem, findTrigger, isContentUpdate } from "../src/ts/features/refresh-now/refreshNow";

beforeEach(() => document.body.replaceChildren());

test("finds the auto-refresh dropdown by name or by its sync icon, ignoring other menus", () => {
  document.body.innerHTML = `
    <button aria-haspopup="true" aria-label="Sort">Sort</button>
    <button id="t" aria-haspopup="true"><span>Auto-refresh</span></button>`;
  expect(findTrigger()?.id).toBe("t");
  document.body.innerHTML = `<button aria-haspopup="true" id="i"><svg class="octicon octicon-sync"></svg></button>`;
  expect(findTrigger()?.id).toBe("i");
  document.body.innerHTML = `<button aria-haspopup="true">Branch</button><button>Auto-refresh</button>`;
  expect(findTrigger()).toBeNull();
});

test("finds the Refresh now item only while the menu is rendered", () => {
  expect(findRefreshItem()).toBeNull();
  document.body.innerHTML = `
    <ul role="menu">
      <li role="menuitemradio" id="a"><span id="a-label">Every minute</span></li>
      <li role="menuitem" aria-labelledby="r-label" id="r"><span id="r-label">Refresh now</span></li>
    </ul>`;
  expect(findRefreshItem()?.id).toBe("r");
});

test("only mutations of page content, after a minimum time, count as the refreshed content", () => {
  document.body.innerHTML = `<main id="m"><p id="p">runs</p></main>
    <div id="__primerPortalRoot__"><span id="menu"></span></div>
    <div class="gha-run-attention"><span id="own"></span></div>
    <button class="gha-refresh-now" id="b"></button>`;
  const at = (id: string) => document.getElementById(id)!;
  expect(isContentUpdate(at("p"), 1000, 1000 + MIN_LOADING_MS - 1)).toBe(false);
  expect(isContentUpdate(at("p"), 1000, 1000 + MIN_LOADING_MS)).toBe(true);
  for (const id of ["menu", "own", "b"]) expect(isContentUpdate(at(id), 0, 10_000), id).toBe(false);
  expect(isContentUpdate(document.createTextNode("x"), 0, 10_000)).toBe(false);
});
