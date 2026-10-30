import { expect, test } from "@rstest/core";
import { mix, withAlpha } from "../src/ts/features/themes/color";
import {
  createThemeId,
  exportThemes,
  importThemes,
  resolvePalette,
  ROLES,
  validateTheme,
  type Theme,
} from "../src/ts/features/themes/theme";
import dracula from "./fixtures/themes/dracula.json";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function themed(name: string, id = createThemeId()): Theme {
  return validateTheme({ ...clone(dracula), id, name });
}

test("ROLES lists the 13 required roles in editor order", () => {
  expect(ROLES).toEqual([
    "bg", "fg", "fgMuted", "border", "accent", "red", "orange",
    "yellow", "green", "cyan", "blue", "purple", "pink",
  ]);
});

test("validateTheme round-trips the Dracula fixture without aliasing", () => {
  const result = validateTheme(dracula);
  expect(result).toEqual(dracula);
  expect(result).not.toBe(dracula);
  expect(result.palette).not.toBe(dracula.palette);
});

test("validateTheme trims the name and drops unknown keys", () => {
  const input = clone(dracula) as Record<string, unknown>;
  input.name = "  Dracula  ";
  input.extra = 1;
  (input.palette as Record<string, unknown>).bogus = "#fff";
  const result = validateTheme(input);
  expect(result).toEqual(dracula);
});

test("validateTheme rejects hostile colors naming the role", () => {
  const input = clone(dracula);
  input.palette.bg = "red; } body{display:none";
  expect(() => validateTheme(input)).toThrow(/bg/);
});

test("validateTheme rejects hostile optional and syntax colors", () => {
  const optional = clone(dracula);
  optional.palette.bgAlt = "url(x)";
  expect(() => validateTheme(optional)).toThrow(/bgAlt/);
  const syntax = clone(dracula);
  syntax.palette.syntax.keyword = "nope";
  expect(() => validateTheme(syntax)).toThrow(/keyword/);
});

test("validateTheme rejects a missing role, bad mode, bad name, bad id", () => {
  const missing = clone(dracula) as { palette: Record<string, unknown> };
  delete missing.palette.pink;
  expect(() => validateTheme(missing)).toThrow(/pink/);
  expect(() => validateTheme({ ...clone(dracula), mode: "blue" })).toThrow(/mode/);
  expect(() => validateTheme({ ...clone(dracula), name: "   " })).toThrow(/name/);
  expect(() => validateTheme({ ...clone(dracula), name: "x".repeat(61) })).toThrow(/name/);
  expect(() => validateTheme({ ...clone(dracula), id: "Bad Id" })).toThrow(/id/);
  expect(() => validateTheme({ ...clone(dracula), id: "a".repeat(65) })).toThrow(/id/);
  expect(() => validateTheme(null)).toThrow();
  expect(() => validateTheme({ ...clone(dracula), palette: null })).toThrow(/palette/);
});

test("createThemeId yields valid, distinct ids", () => {
  const a = createThemeId();
  expect(a).toMatch(/^custom-[a-z0-9]{8}$/);
  expect(createThemeId()).not.toBe(a);
  expect(() => validateTheme({ ...clone(dracula), id: a })).not.toThrow();
});

test("resolvePalette keeps provided optional roles", () => {
  const resolved = resolvePalette(validateTheme(dracula).palette, "dark");
  expect(resolved.bgAlt).toBe("#21222c");
  expect(resolved.bgInset).toBe("#191a21");
  expect(resolved.comment).toBe("#6272a4");
  expect(resolved.selection).toBe("#44475a");
  expect(resolved.syntax.keyword).toBe("#ff79c6");
});

test("resolvePalette derives dark defaults", () => {
  const palette = clone(validateTheme(dracula).palette);
  delete palette.bgAlt;
  delete palette.bgInset;
  delete palette.comment;
  delete palette.selection;
  delete palette.syntax;
  const r = resolvePalette(palette, "dark");
  expect(r.bgAlt).toBe(mix(palette.fg, palette.bg, 0.04));
  expect(r.bgInset).toBe(mix("#000000", palette.bg, 0.25));
  expect(r.comment).toBe(palette.fgMuted);
  expect(r.selection).toBe(withAlpha(palette.accent, 0.7));
  expect(r.syntax).toEqual({
    keyword: palette.pink,
    function: palette.green,
    constant: palette.purple,
    string: palette.yellow,
    tag: palette.cyan,
    variable: palette.orange,
  });
});

test("resolvePalette light derives bgInset from bgAlt and selection at 0.2", () => {
  const palette = clone(validateTheme(dracula).palette);
  delete palette.bgAlt;
  delete palette.bgInset;
  delete palette.selection;
  const r = resolvePalette(palette, "light");
  expect(r.bgInset).toBe(r.bgAlt);
  expect(r.selection).toBe(withAlpha(palette.accent, 0.2));
});

test("resolvePalette merges partial syntax", () => {
  const palette = clone(validateTheme(dracula).palette);
  palette.syntax = { keyword: "#123456" };
  const r = resolvePalette(palette, "dark");
  expect(r.syntax.keyword).toBe("#123456");
  expect(r.syntax.function).toBe(palette.green);
});

test("exportThemes writes the gha-themes envelope", () => {
  const themes = [themed("A")];
  expect(JSON.parse(exportThemes(themes))).toEqual({
    format: "gha-themes",
    version: 1,
    themes,
  });
});

test("importThemes adds, then replaces by name keeping ids", () => {
  const themes = [themed("One"), themed("Two"), themed("Three")];
  const text = exportThemes(themes);
  const first = importThemes(text, []);
  expect(first.added).toBe(3);
  expect(first.replaced).toBe(0);
  expect(first.themes).toEqual(themes);

  const again = importThemes(
    exportThemes(themes.map((t) => ({ ...t, id: createThemeId(), name: t.name.toUpperCase() }))),
    first.themes,
  );
  expect(again.added).toBe(0);
  expect(again.replaced).toBe(3);
  expect(again.themes.map((t) => t.id)).toEqual(themes.map((t) => t.id));
  expect(again.themes.map((t) => t.name)).toEqual(["ONE", "TWO", "THREE"]);
});

test("importThemes regenerates colliding ids for added themes", () => {
  const existing = [themed("Mine", "shared")];
  const incoming = themed("Other", "shared");
  const result = importThemes(exportThemes([incoming]), existing);
  expect(result.added).toBe(1);
  expect(result.themes[0].id).toBe("shared");
  expect(result.themes[1].id).not.toBe("shared");
  expect(result.themes[1].name).toBe("Other");
});

test("importThemes rejects non-JSON, wrong format, and oversize files", () => {
  expect(() => importThemes("not json", [])).toThrow();
  expect(() => importThemes('{"format":"other"}', [])).toThrow(/format/);
  const many = Array.from({ length: 201 }, (_, i) => themed(`T${i}`));
  expect(() => importThemes(exportThemes(many), [])).toThrow(/200/);
});

test("importThemes throws on a hostile theme and leaves existing untouched", () => {
  const existing = [themed("Keep")];
  const snapshot = clone(existing);
  const hostile = clone(themed("Evil"));
  hostile.palette.fg = "red; } body{display:none";
  const text = JSON.stringify({ format: "gha-themes", version: 1, themes: [themed("Good"), hostile] });
  expect(() => importThemes(text, existing)).toThrow(/fg/);
  expect(existing).toEqual(snapshot);
});
