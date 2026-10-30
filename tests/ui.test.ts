import { expect, test } from "@rstest/core";
import { ui } from "../src/ts/core/ui";

test("writer runs writes in order and continues after a failure", async () => {
  const log: string[] = [];
  const errors: unknown[] = [];
  const area: Record<string, unknown> = {};
  (globalThis as any).browser = {
    storage: {
      onChanged: { addListener: () => {} },
      local: {
        get: async () => ({}),
        set: async (entry: Record<string, unknown>) => {
          const [key] = Object.keys(entry);
          log.push(key);
          if (key.includes("bad")) throw new Error("fail");
          Object.assign(area, entry);
        },
      },
    },
  };
  const { store } = await import("../src/ts/core/settings");
  const write = store.writer((error) => errors.push(error));
  await Promise.all([
    write("sidebarWidth", "first", 1),
    write("sidebarWidth", "bad", 2),
    write("sidebarWidth", "last", 3),
  ]);
  expect(log.map((key) => key.replace(/^.*(first|bad|last)$/, "$1"))).toEqual(["first", "bad", "last"]);
  expect(errors).toHaveLength(1);
});

test("detailsMenu closes on outside click and on Escape focusing the summary", () => {
  document.body.innerHTML = `<details open><summary>s</summary><p>in</p></details><div id="out"></div>`;
  const menu = document.querySelector("details")!;
  const dispose = ui.detailsMenu(menu);
  menu.querySelector("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(menu.open).toBe(true);
  document.getElementById("out")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(menu.open).toBe(false);
  menu.open = true;
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector("summary"));
  dispose();
});

test("isPlainClick is false with modifiers or a non-primary button", () => {
  expect(ui.isPlainClick({ ctrlKey: true } as MouseEvent)).toBe(false);
  expect(ui.isPlainClick({ button: 1 } as MouseEvent)).toBe(false);
  expect(ui.isPlainClick({ button: 0 } as MouseEvent)).toBe(true);
});

test("toggle reports the next state and syncs aria-pressed", () => {
  const seen: boolean[] = [];
  const t = ui.toggle({ label: "L", labelId: "l1", pressed: false, onChange: (n) => seen.push(n) });
  t.button.click();
  t.sync(true);
  t.button.click();
  expect(seen).toEqual([true, false]);
  expect(t.button.getAttribute("aria-pressed")).toBe("true");
});
