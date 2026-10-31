import { expect, test } from "@rstest/core";
import { findTheme, isBuiltin } from "../src/ts/features/themes/builtins";
import { BUILTIN_THEMES } from "./shipped-themes";
import { contrast } from "../src/ts/features/themes/color";
import { generateStylesheet } from "../src/ts/features/themes/generate";
import { validateTheme, type Theme } from "../src/ts/features/themes/theme";
import alucard from "./fixtures/themes/alucard.json";
import dracula from "./fixtures/themes/dracula.json";
import nord from "./fixtures/themes/nord.json";
import oneDark from "./fixtures/themes/one-dark.json";
import solarizedLight from "./fixtures/themes/solarized-light.json";

const IDS = [
  "dracula",
  "alucard",
  "one-dark",
  "monokai",
  "catppuccin-mocha",
  "catppuccin-latte",
  "nord",
  "tokyo-night",
  "gruvbox-dark",
  "gruvbox-light",
  "solarized-dark",
  "solarized-light",
  "ayu-dark",
  "rose-pine",
];

const FIXTURES: Record<string, { palette: unknown }> = {
  dracula,
  alucard,
  nord,
  "one-dark": oneDark,
  "solarized-light": solarizedLight,
};

const byId = (id: string): Theme => {
  const theme = findTheme(id, BUILTIN_THEMES);
  if (!theme) throw new Error(id);
  return theme;
};

test("ids are the expected unique list in order", () => {
  expect(BUILTIN_THEMES.map((t) => t.id)).toEqual(IDS);
  expect(new Set(IDS).size).toBe(IDS.length);
});

test("every built-in validates and modes are 10 dark, 4 light", () => {
  for (const theme of BUILTIN_THEMES) {
    expect(validateTheme(JSON.parse(JSON.stringify(theme)))).toEqual(theme);
  }
  expect(BUILTIN_THEMES.filter((t) => t.mode === "dark")).toHaveLength(10);
  expect(BUILTIN_THEMES.filter((t) => t.mode === "light")).toHaveLength(4);
});

test("contrast floors hold for every built-in", () => {
  for (const { id, palette: p } of BUILTIN_THEMES) {
    expect(contrast(p.fg, p.bg), `${id} fg`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.fgMuted, p.bg), `${id} fgMuted`).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(p.accent, p.bg), `${id} accent`).toBeGreaterThanOrEqual(3);
  }
});

test("findTheme resolves built-ins, custom, and unknowns", () => {
  expect(findTheme("dracula", BUILTIN_THEMES)?.name).toBe("Dracula");
  expect(findTheme("nope", BUILTIN_THEMES)).toBeUndefined();
  expect(findTheme(null, BUILTIN_THEMES)).toBeUndefined();
  const mine = { ...byId("nord"), id: "mine", name: "Mine" };
  expect(findTheme("mine", [mine])).toBe(mine);
  expect(isBuiltin("nord")).toBe(true);
  expect(isBuiltin("mine")).toBe(false);
});

test("the first theme in the list wins, so shipped themes listed before custom ones are not shadowed", () => {
  const fake = { ...byId("nord"), name: "Fake" };
  expect(findTheme("nord", [...BUILTIN_THEMES, fake])?.name).toBe("Nord");
});

test("fixture palettes match the built-ins", () => {
  for (const [id, fixture] of Object.entries(FIXTURES)) {
    expect(byId(id).palette).toEqual(fixture.palette);
  }
});

test("every built-in generates a stylesheet", () => {
  for (const theme of BUILTIN_THEMES) {
    expect(generateStylesheet({ [theme.mode]: theme }).length).toBeGreaterThan(
      0,
    );
  }
});
