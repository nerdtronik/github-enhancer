import { beforeEach, describe, expect, test } from "@rstest/core";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { builtinIds, isBuiltin, registerBuiltinIds } from "../src/ts/features/themes/builtins";
import { BUILTIN_THEMES } from "./shipped-themes";
import { parseIndex, swatches } from "../src/ts/features/themes/catalog";
import { generateStylesheet } from "../src/ts/features/themes/generate";
import { createThemeController } from "../src/ts/features/themes/injector";
import { mountThemesSection } from "../src/ts/features/themes/themesSection";
import { validateTheme, type Theme, type ThemeMode } from "../src/ts/features/themes/theme";

const root = join(__dirname, "..", "assets", "themes");
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const colors = ["#101010", "#eeeeee", "#3b82f6", "#ef4444", "#22c55e", "#eab308", "#60a5fa"];
const entry = (id: string, name: string, mode: ThemeMode = "dark") => ({ id, name, mode, colors });

describe("catalog files", () => {
  test("every index entry is valid and has a valid theme file with the same id", () => {
    expect(parseIndex(index)).toHaveLength(index.length);
    expect(index.length).toBeGreaterThan(100);
    for (const item of index) {
      const theme = validateTheme(JSON.parse(readFileSync(join(root, `${item.id}.json`), "utf8")));
      expect(theme.id).toBe(item.id);
      expect(theme.mode).toBe(item.mode);
      expect(swatches(theme)).toEqual(item.colors);
    }
    expect(readdirSync(root)).toHaveLength(index.length + 1);
  });

  test("ids are unique and the hand-tuned themes are listed", () => {
    const ids = index.map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const theme of BUILTIN_THEMES) expect(ids).toContain(theme.id);
    // "default" is the GitHub default row of the picker; "index" is the list file.
    expect(ids).not.toContain("default");
    expect(ids).not.toContain("index");
  });

  test("every theme declares a permissive license, an author field and an upstream", () => {
    for (const item of index) {
      const file = JSON.parse(readFileSync(join(root, `${item.id}.json`), "utf8"));
      // Hand-tuned themes have no upstream field; their credits are in THIRD_PARTY_NOTICES.md.
      if (!("upstream" in file)) continue;
      expect(["MIT", "Apache-2.0", "CC0-1.0", "UPL-1.0", "ISC", "Unlicense", "BSD-2-Clause", "BSD-3-Clause"]).toContain(file.license);
      expect(typeof file.author).toBe("string");
      expect(typeof file.upstream).toBe("string");
    }
  });
});

describe("shipped theme ids", () => {
  test("count as built-in once registered, so custom themes cannot reuse them", () => {
    expect(isBuiltin("adwaita-dark")).toBe(false);
    registerBuiltinIds(["adwaita-dark"]);
    expect(isBuiltin("adwaita-dark")).toBe(true);
    expect(builtinIds()).toContain("adwaita-dark");
  });
});

describe("parseIndex", () => {
  test("keeps well-formed entries and drops malformed ones", () => {
    const good = entry("ok", "Ok");
    const bad = [
      null,
      "x",
      entry("Bad Id", "Name"),
      entry("name", ""),
      { ...entry("mode", "Mode"), mode: "dim" },
      { ...entry("short", "Short"), colors: colors.slice(1) },
      { ...entry("color", "Color"), colors: [...colors.slice(1), "red"] },
      { ...entry("url", "Url"), colors: [...colors.slice(1), "url(x)"] },
    ];
    expect(parseIndex([...bad, good])).toEqual([good]);
    expect(parseIndex({})).toEqual([]);
  });
});

describe("picker with catalog rows", () => {
  const page = `<appearance-form><form><input type="radio" name="user_theme" data-mode="dark"></form></appearance-form>`;
  const none = { light: null, dark: null };
  const handlers = { select: () => {}, clear: () => {}, actions: { duplicate: () => {}, edit: () => {}, remove: () => {} }, toolbar: { create: () => {}, importFile: () => {}, exportAll: () => {} } };
  beforeEach(() => {
    document.body.innerHTML = page;
  });

  test("lists catalog themes after built-ins, once, and filters them by the search text", () => {
    const catalog = [entry("one", "Alpha Night"), entry("two", "Beta Day", "light"), entry("dracula", "Dracula again")];
    mountThemesSection(document, BUILTIN_THEMES, none, handlers, catalog);
    const dark = document.querySelector('[data-gha-themes-mode="dark"]')!;
    const names = [...dark.querySelectorAll(".gha-theme-row .gha-theme-name")].map((n) => n.textContent);
    expect(names.at(-1)).toBe("Alpha Night");
    expect(names).not.toContain("Dracula again");
    expect(dark.querySelector('[data-gha-theme="one"] .Label')?.textContent).toBe("Built-in");
    expect(dark.querySelectorAll('[data-gha-theme="one"] [data-gha-action]').length).toBe(1);
    const search = dark.querySelector<HTMLInputElement>(".gha-theme-search")!;
    search.value = "alpha";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const visible = [...dark.querySelectorAll<HTMLElement>(".gha-theme-row")].filter((row) => !row.hidden);
    expect(visible.map((row) => row.querySelector(".gha-theme-name")!.textContent)).toEqual(["GitHub default", "Alpha Night"]);
    search.value = "zzz";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dark.querySelector("p.mb-0")!.hasAttribute("hidden")).toBe(false);
  });
});

describe("controller with a catalog theme", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const dracula = BUILTIN_THEMES.find((t) => t.id === "dracula")!;
  const catalogTheme: Theme = validateTheme({ ...dracula, id: "test", name: "Test" });

  test("fetches the active catalog theme and repaints; a failed id is requested once", async () => {
    document.getElementById("gha-themes")?.remove();
    const asked: string[] = [];
    const controller = createThemeController({
      doc: document,
      ready: Promise.resolve(),
      readIds: () => ({ light: null, dark: "test" }),
      loadCustom: () => Promise.resolve([]),
      watchCustom: () => {},
      onIdsChange: () => {},
      loadCatalogTheme: async (id) => (asked.push(id), id === "test" ? catalogTheme : undefined),
    });
    await controller.start();
    await flush();
    expect(document.getElementById("gha-themes")?.textContent).toBe(generateStylesheet({ dark: catalogTheme }));
    controller.render();
    await flush();
    expect(asked).toEqual(["test"]);
    expect(controller.getCatalogThemes().map((t) => t.id)).toEqual(["test"]);
  });
});
