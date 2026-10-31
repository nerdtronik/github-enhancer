import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { BUILTIN_THEMES } from "./shipped-themes";
import { isAppearancePage, shouldRemount, startAndMount } from "../src/ts/features/themes/appearancePage";
import { parseColor } from "../src/ts/features/themes/color";
import { mountThemesSection } from "../src/ts/features/themes/themesSection";
import { previewDataUrl } from "../src/ts/features/themes/previewSvg";
import { validateTheme, type ThemeMode } from "../src/ts/features/themes/theme";

const fixture = readFileSync(join(__dirname, "fixtures/appearance-single-picker.html"), "utf8");
const page = (inner = fixture) =>
  `<appearance-form><form>${inner}</form></appearance-form><div id="after">after</div>`;
const palette = BUILTIN_THEMES[0].palette;
const custom = (name: string, mode: ThemeMode = "dark", id = "mine") => validateTheme({ id, name, mode, palette });

const calls: string[] = [];
const handlers = {
  select: (mode: ThemeMode, id: string) => void calls.push(`select:${mode}:${id}`),
  clear: (mode: ThemeMode) => void calls.push(`clear:${mode}`),
  toolbar: { create: () => {}, importFile: () => {}, exportAll: () => {} },
};
const none = { light: null, dark: null };
const section = () => document.querySelector<HTMLElement>("[data-gha-themes-section]");
const sub = (mode: ThemeMode) => section()!.querySelector<HTMLElement>(`[data-gha-themes-mode="${mode}"]`)!;
const grid = (mode: ThemeMode) => sub(mode).querySelector<HTMLElement>('[role="radiogroup"]')!;
const cellIds = (mode: ThemeMode) =>
  [...grid(mode).children].map((c) => (c.hasAttribute("data-gha-theme-default") ? "" : (c as HTMLElement).dataset.ghaTheme));
const radio = (id: string) => document.getElementById(id) as HTMLInputElement;
const githubRadios = () => [...document.querySelectorAll<HTMLInputElement>('input[name="user_theme"]')];
const builtinIds = (mode: ThemeMode) => BUILTIN_THEMES.filter((t) => t.mode === mode).map((t) => t.id);

beforeEach(() => {
  calls.length = 0;
  document.body.innerHTML = page();
});

describe("mountThemesSection placement", () => {
  test("goes right after GitHub's appearance-form and before what follows", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(document.querySelector("appearance-form")!.nextElementSibling).toBe(section());
    expect(section()!.nextElementSibling).toBe(document.getElementById("after"));
    expect(section()!.closest("form, appearance-form")).toBeNull();
  });

  test("falls back to after the form", () => {
    document.body.innerHTML = `<form>${fixture}</form><div id="after"></div>`;
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(document.querySelector("form")!.nextElementSibling).toBe(section());
  });

  test("falls back to after the radiogroup's parent", () => {
    document.body.innerHTML = `<div id="wrap">${fixture}</div><div id="after"></div>`;
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(document.getElementById("wrap")!.nextElementSibling).toBe(section());
  });

  test("without GitHub radios nothing is mounted and an old section is removed", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    document.querySelector("appearance-form")!.remove();
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(section()).toBeNull();
    document.body.innerHTML = '<div role="radiogroup"><input type="radio" name="x"></div>';
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(section()).toBeNull();
  });

  test("mounting twice keeps one section, one toolbar and one card per theme", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(document.querySelectorAll("[data-gha-themes-section]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-gha-themes-toolbar]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-gha-theme]")).toHaveLength(14);
    radio("gha-theme-dracula-dark").click();
    expect(calls).toHaveLength(1);
  });

  test("re-places the section after GitHub re-renders its form", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    document.querySelector("appearance-form")!.remove();
    const fresh = document.createElement("appearance-form");
    fresh.innerHTML = `<form>${fixture}</form>`;
    document.body.append(fresh);
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(document.querySelectorAll("[data-gha-themes-section]")).toHaveLength(1);
    expect(fresh.nextElementSibling).toBe(section());
  });

  test("dispose removes the section and its listeners", () => {
    const dispose = mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    const old = section()!;
    dispose();
    expect(section()).toBeNull();
    expect(document.body.innerHTML).toBe(page());
    radio("option-dark").click();
    document.body.append(old);
    old.querySelector<HTMLInputElement>("#gha-theme-dracula-dark")!.click();
    expect(calls).toEqual([]);
  });
});

describe("mountThemesSection layout", () => {
  test("heading, intro, toolbar, then Dark and Light sub-sections", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    const root = section()!;
    expect(root.querySelector(".Subhead > h2.Subhead-heading")!.textContent).toBe("Custom themes");
    expect(root.querySelector(":scope > p")!.textContent).toBe(
      "Pick a theme for each mode. A theme only applies while GitHub itself is in the same mode.",
    );
    const order = [...root.children].map((c) =>
      c.hasAttribute("data-gha-themes-toolbar") ? "toolbar" : ((c as HTMLElement).dataset.ghaThemesMode ?? c.tagName),
    );
    expect(order).toEqual(["DIV", "P", "toolbar", "dark", "light"]);
    expect(document.querySelector("[data-gha-themes-note]")).toBeNull();
  });

  test("sub-section headings and activation texts", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(sub("dark").querySelector("h3")!.textContent).toBe("Dark themes");
    expect(sub("light").querySelector("h3")!.textContent).toBe("Light themes");
    expect(sub("dark").querySelector("p.color-fg-muted.text-small")!.textContent).toBe(
      'Applies when GitHub is in a dark mode. To use one of these, first select one of GitHub\'s dark themes above (for example "Dark default"), then choose a theme here. With "Sync with system", this theme is used for dark mode.',
    );
    expect(sub("light").querySelector("p.color-fg-muted.text-small")!.textContent).toBe(
      'Applies when GitHub is in a light mode. To use one of these, first select one of GitHub\'s light themes above (for example "Light default"), then choose a theme here. With "Sync with system", this theme is used for light mode.',
    );
    expect(grid("dark").getAttribute("aria-label")).toBe("Custom dark themes");
    expect(grid("light").getAttribute("aria-label")).toBe("Custom light themes");
    expect(grid("dark").className).toBe("gha-theme-list");
    expect(section()!.querySelector("[data-mode]")).toBeNull();
  });

  test("each grid lists default, built-ins, then custom themes of its Mode", () => {
    const themes = [custom("Mine dark", "dark", "mine-d"), ...BUILTIN_THEMES, custom("Mine light", "light", "mine-l")];
    mountThemesSection(document, themes, none, handlers);
    expect(cellIds("dark")).toEqual(["", ...builtinIds("dark"), "mine-d"]);
    expect(cellIds("light")).toEqual(["", ...builtinIds("light"), "mine-l"]);
    expect(builtinIds("dark")).toHaveLength(10);
    expect(builtinIds("light")).toHaveLength(4);
  });

  test("builtin row markup: a chip with the theme colors, the name and a badge", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    const row = document.querySelector<HTMLElement>('[data-gha-theme="dracula"]')!;
    expect(row.className).toBe("gha-theme-row");
    expect(row.querySelector(".Label")?.textContent).toBe("Built-in");
    expect(row.querySelector("img")).toBeNull();
    const chip = row.querySelector<HTMLElement>(".gha-theme-chip")!;
    expect(chip.style.backgroundColor).not.toBe("");
    expect(chip.querySelectorAll(".gha-theme-dot")).toHaveLength(6);
    expect(row.querySelector(".gha-theme-name")?.textContent).toBe("Dracula");
    expect(row.querySelector("label")!.htmlFor).toBe("gha-theme-dracula-dark");
    expect(document.querySelector('[data-gha-theme="alucard"] .gha-theme-name')!.textContent).toBe("Alucard");
  });

  test("GitHub default row", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    const row = grid("dark").firstElementChild as HTMLElement;
    expect(row.hasAttribute("data-gha-theme-default")).toBe(true);
    const input = row.querySelector("input")!;
    expect([input.id, input.name, input.value]).toEqual(["gha-theme-default-dark", "gha_theme_dark", ""]);
    expect(row.querySelector(".gha-theme-chip")!.classList.contains("gha-theme-chip-empty")).toBe(true);
    expect(row.querySelector(".gha-theme-name")!.textContent).toBe("GitHub default");
    expect(row.querySelector(".Label, button, img")).toBeNull();
  });

  test("hostile name renders as literal text", () => {
    mountThemesSection(document, [custom("<img src=x onerror=alert(1)>")], none, handlers);
    expect(document.querySelector("img[onerror]")).toBeNull();
    const row = document.querySelector('[data-gha-theme="mine"]')!;
    expect(row.querySelector(".gha-theme-name")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(row.querySelector(".Label")?.textContent).toBe("Custom");
  });

  test("radios are detached from GitHub's form and have unique ids", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    const ours = [...section()!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(ours).toHaveLength(16);
    for (const r of ours) {
      expect(r.getAttribute("form")).toBe("gha-themes-detached");
      expect(r.name).toBe(`gha_theme_${r.dataset.ghaMode}`);
      for (const attr of ["data-mode", "data-throttled-autosubmit", "data-action"])
        expect(r.hasAttribute(attr), attr).toBe(false);
    }
    expect(new Set(ours.map((r) => r.name))).toEqual(new Set(["gha_theme_dark", "gha_theme_light"]));
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("stale cards are removed on remount", () => {
    mountThemesSection(document, [...BUILTIN_THEMES, custom("Mine")], none, handlers);
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    expect(document.querySelector('[data-gha-theme="mine"]')).toBeNull();
  });
});

describe("mountThemesSection selection", () => {
  test("selecting a card calls select once and checks only it in its Mode", () => {
    mountThemesSection(document, BUILTIN_THEMES, { light: "alucard", dark: null }, handlers);
    radio("gha-theme-dracula-dark").click();
    expect(calls).toEqual(["select:dark:dracula"]);
    const checked = [...grid("dark").querySelectorAll<HTMLInputElement>("input:checked")].map((r) => r.id);
    expect(checked).toEqual(["gha-theme-dracula-dark"]);
    expect(document.querySelector('[data-gha-theme="dracula"]')!.hasAttribute("data-gha-active")).toBe(true);
    expect(radio("gha-theme-alucard-light").checked).toBe(true);
  });

  test("the default card clears the Mode", () => {
    mountThemesSection(document, BUILTIN_THEMES, { light: null, dark: "dracula" }, handlers);
    radio("gha-theme-default-dark").click();
    expect(calls).toEqual(["clear:dark"]);
    expect(radio("gha-theme-dracula-dark").checked).toBe(false);
    expect(grid("dark").firstElementChild!.hasAttribute("data-gha-active")).toBe(true);
  });

  test("Active theme is checked and marked on mount, otherwise the default card", () => {
    mountThemesSection(document, BUILTIN_THEMES, { light: null, dark: "dracula" }, handlers);
    expect(radio("gha-theme-dracula-dark").checked).toBe(true);
    expect(radio("gha-theme-default-dark").checked).toBe(false);
    expect(document.querySelector('[data-gha-theme="dracula"]')!.hasAttribute("data-gha-active")).toBe(true);
    expect(radio("gha-theme-default-light").checked).toBe(true);
    expect(section()!.querySelectorAll("[data-gha-active]")).toHaveLength(2);
    expect(section()!.querySelectorAll("input:checked")).toHaveLength(2);
  });

  test("an unknown Active id falls back to the default card", () => {
    mountThemesSection(document, BUILTIN_THEMES, { light: null, dark: "gone" }, handlers);
    expect(radio("gha-theme-default-dark").checked).toBe(true);
  });

  test("clicking GitHub's radio does not clear ours", () => {
    mountThemesSection(document, BUILTIN_THEMES, { light: null, dark: "dracula" }, handlers);
    radio("option-dark_dimmed").click();
    expect(calls).toEqual([]);
    expect(radio("gha-theme-dracula-dark").checked).toBe(true);
    expect(radio("option-dark_dimmed").checked).toBe(true);
  });

  test("GitHub's radios are untouched by our interactions", () => {
    const snapshot = githubRadios().map((r) => [r.checked, r.outerHTML]);
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    radio("gha-theme-dracula-dark").click();
    radio("gha-theme-default-light").click();
    radio("gha-theme-alucard-light").click();
    expect(githubRadios().map((r) => [r.checked, r.outerHTML])).toEqual(snapshot);
  });

  test("our events never reach document listeners", () => {
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    const seen: string[] = [];
    for (const type of ["click", "change"]) document.addEventListener(type, (e) => void seen.push(e.type));
    radio("gha-theme-dracula-dark").click();
    radio("gha-theme-default-dark").click();
    expect(seen).toEqual([]);
  });
});

describe("themes.css", () => {
  const css = readFileSync(join(__dirname, "../src/css/themes.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(",").map((s) => s.trim()),
    body,
  }));

  test("never draws a ring or border on the card cell", () => {
    for (const { selectors, body } of rules) {
      const cell = selectors.some((s) => /\[data-gha-theme(-default)?\](\[[^\]]*\])*$/.test(s));
      if (cell) expect(body, selectors.join()).not.toMatch(/(^|[;\s])(outline|box-shadow|border)[\w-]*\s*:/);
    }
  });

  test("the active row is marked with a background and an inset bar, nothing else", () => {
    const row = rules.find(({ selectors }) => selectors.includes(".gha-theme-row[data-gha-active]"));
    expect(row).toBeDefined();
    const properties = row!.body.split(";").map((d) => d.trim().split(":")[0]).filter(Boolean);
    expect(properties).toEqual(["background", "box-shadow"]);
  });

  test("uses no color literals", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

describe("appearance page helpers", () => {
  const record = (added: Node[], removed: Node[] = []) =>
    [{ addedNodes: added, removedNodes: removed }] as unknown as MutationRecord[];

  test("shouldRemount fires for GitHub's radios and our removed section only", () => {
    expect(shouldRemount(record([document.body.firstElementChild!]))).toBe(true);
    mountThemesSection(document, BUILTIN_THEMES, none, handlers);
    const ours = section()!;
    expect(shouldRemount(record([ours]))).toBe(false);
    expect(shouldRemount(record([ours.querySelector("[data-gha-theme]")!]))).toBe(false);
    expect(shouldRemount(record([], [ours.querySelector("[data-gha-theme]")!]))).toBe(false);
    expect(shouldRemount(record([], [ours]))).toBe(false);
    ours.remove();
    expect(shouldRemount(record([], [ours]))).toBe(true);
    const wrapper = document.createElement("div");
    wrapper.append(ours);
    expect(shouldRemount(record([], [wrapper]))).toBe(true);
  });

  test("startAndMount starts the scheduler, then schedules the first mount", () => {
    const order: string[] = [];
    startAndMount({ start: () => void order.push("start"), schedule: () => void order.push("schedule") });
    expect(order).toEqual(["start", "schedule"]);
  });

  test("isAppearancePage handles trailing slash and other pages", () => {
    const at = (path: string) => {
      history.replaceState(null, "", path);
      return isAppearancePage();
    };
    expect(at("/settings/appearance")).toBe(true);
    expect(at("/settings/appearance/")).toBe(true);
    expect(at("/settings/profile")).toBe(false);
    expect(at("/settings/appearance/x")).toBe(false);
  });
});

describe("previewDataUrl", () => {
  test("uses only valid hex colors and no active content", () => {
    for (const theme of BUILTIN_THEMES) {
      const svg = decodeURIComponent(previewDataUrl(theme).split(",").slice(1).join(","));
      for (const color of svg.match(/#[0-9a-f]{3,8}\b/gi) ?? []) expect(() => parseColor(color), color).not.toThrow();
      expect(svg).not.toMatch(/rgb\(|url\(|javascript:|\son\w+=/i);
    }
  });

  const decode = (url: string) => decodeURIComponent(url.split(",").slice(1).join(","));

  test("contains bg and accent and no script", () => {
    const theme = BUILTIN_THEMES.find((t) => t.id === "dracula")!;
    const url = previewDataUrl(theme);
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const svg = decode(url);
    expect(svg).toContain(theme.palette.bg);
    expect(svg).toContain(theme.palette.accent);
    expect(svg).not.toContain("<script");
  });

  test("matches GitHub's preview aspect ratio", () => {
    const svg = decode(previewDataUrl(BUILTIN_THEMES[0]));
    const [, , width, height] = /viewBox="([^"]+)"/.exec(svg)![1].split(" ").map(Number);
    expect(Math.abs(height / width - 0.526316)).toBeLessThan(0.002);
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
  });

  test("differs between themes", () => {
    expect(decode(previewDataUrl(BUILTIN_THEMES[0]))).not.toBe(decode(previewDataUrl(BUILTIN_THEMES[5])));
  });
});
