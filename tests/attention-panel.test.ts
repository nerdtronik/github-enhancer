import { beforeEach, expect, test } from "@rstest/core";
import { createAttentionPanel, type PanelItem } from "../src/ts/features/run-list/attentionPanel";

const item = (id: string, title = `Run ${id}`): PanelItem => ({
  id,
  url: `/o/r/actions/runs/${id}`,
  title,
  status: "Failed",
  tone: "danger",
  branch: "main",
  meta: "ci · 5m ago",
  detail: "",
});
const model = (items: PanelItem[], extra = {}) => ({ items, collapsed: false, showAll: false, dismissed: 0, ...extra });
const calls: string[] = [];
const make = () =>
  createAttentionPanel({
    toggleCollapsed: () => calls.push("collapse"),
    toggleShowAll: () => calls.push("all"),
    dismiss: (id) => calls.push(`dismiss:${id}`),
    restore: () => calls.push("restore"),
  });

beforeEach(() => {
  calls.length = 0;
  document.body.replaceChildren();
});

test("renders a count, items and keeps unchanged nodes across renders", () => {
  const panel = make();
  document.body.append(panel.element);
  panel.render(model([item("1"), item("2")]));
  expect(panel.element.querySelector(".gha-run-attention-count")?.textContent).toBe("2");
  const first = panel.element.querySelector("li");
  panel.render(model([item("1"), item("2"), item("3")]));
  expect(panel.element.querySelectorAll("li")).toHaveLength(3);
  expect(panel.element.querySelector("li")).toBe(first);
  panel.render(model([item("3"), item("1")]));
  expect([...panel.element.querySelectorAll("li")].map((li) => (li as HTMLElement).dataset.key)).toEqual(["3", "1"]);
});

test("a changed item is replaced and an unchanged toggle keeps focus", () => {
  const panel = make();
  document.body.append(panel.element);
  panel.render(model([item("1")]));
  const toggle = panel.element.querySelector<HTMLButtonElement>(".gha-run-attention-toggle-panel")!;
  toggle.focus();
  const before = panel.element.querySelector("li");
  panel.render(model([item("1", "Renamed")]));
  expect(panel.element.querySelector("li")).not.toBe(before);
  expect(panel.element.querySelector("li a")?.textContent).toBe("Renamed");
  expect(document.activeElement).toBe(toggle);
});

test("shows five items, a show more button and the empty and collapsed states", () => {
  const panel = make();
  document.body.append(panel.element);
  const items = Array.from({ length: 7 }, (_, index) => item(String(index)));
  panel.render(model(items));
  expect(panel.element.querySelectorAll("li")).toHaveLength(5);
  const more = [...panel.element.querySelectorAll<HTMLButtonElement>(".gha-run-attention-more")].find((b) => !b.hidden)!;
  expect(more.textContent).toBe("Show 2 more");
  panel.render(model(items, { showAll: true }));
  expect(panel.element.querySelectorAll("li")).toHaveLength(7);
  panel.render(model(items, { collapsed: true }));
  expect(panel.element.querySelectorAll("li")).toHaveLength(0);
  expect(panel.element.querySelector(".gha-run-attention-toggle-panel")?.getAttribute("aria-expanded")).toBe("false");
  panel.render(model([]));
  expect(panel.element.querySelector("p")?.hidden).toBe(false);
});

test("dismiss, restore and the toggles call the actions", () => {
  const panel = make();
  document.body.append(panel.element);
  panel.render(model([item("9")], { dismissed: 2 }));
  panel.element.querySelector<HTMLButtonElement>(".gha-run-attention-dismiss")!.click();
  panel.element.querySelector<HTMLButtonElement>(".gha-run-attention-toggle-panel")!.click();
  const restore = [...panel.element.querySelectorAll<HTMLButtonElement>(".gha-run-attention-more")].find((b) => !b.hidden)!;
  expect(restore.textContent).toBe("Restore dismissed (2)");
  restore.click();
  expect(calls).toEqual(["dismiss:9", "collapse", "restore"]);
});
