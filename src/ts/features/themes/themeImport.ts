/**
 * Converts a theme defined by terminal colors (foreground, background and the 16 ANSI colors) to
 * a Theme. Used only by scripts/import-themes.js at development time to generate the built-in
 * theme files in assets/themes; it is not part of any bundle.
 */
import { contrast, mix } from "./color";
import { THEME_ID_PATTERN } from "../../core/definitions";
import { MAX_NAME, validateTheme, type Theme } from "./theme";

export interface ThemeMeta {
  name: string;
  author: string;
  license: string;
  upstream: string;
}

export interface Converted {
  theme: Theme;
  meta: ThemeMeta;
}

/** Licenses compatible with redistributing the colors in an MIT-licensed extension. */
export const PERMISSIVE = new Set(["MIT", "Apache-2.0", "CC0-1.0", "UPL-1.0", "ISC", "Unlicense", "BSD-2-Clause", "BSD-3-Clause"]);

const ALIASES: Record<string, string> = { "cc0 1.0": "CC0-1.0", "cc0": "CC0-1.0", "apache 2.0": "Apache-2.0", "apache-2": "Apache-2.0", mit: "MIT" };

/** Maps common spellings to SPDX ids so the permissive check compares like with like. */
export const normalizeLicense = (license: string): string => ALIASES[license.trim().toLowerCase()] ?? license.trim();

export function parseTerminalTheme(text: string): { meta: Partial<ThemeMeta>; colors: Record<string, string> } {
  const meta: Partial<ThemeMeta> = {};
  const colors: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const comment = /^##\s*(name|author|license|upstream):\s*(.*)$/.exec(line);
    if (comment) {
      meta[comment[1] as keyof ThemeMeta] = comment[2].trim();
      continue;
    }
    const entry = /^(foreground|background|selection_background|color\d{1,2})\s+(#[0-9a-fA-F]{6})\s*$/.exec(line);
    if (entry) colors[entry[1]] = entry[2].toLowerCase();
  }
  return { meta, colors };
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Lowercase letters and digits only; two names with the same key are the same theme. */
export const nameKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export const themeId = (name: string): string => slug(name).slice(0, 64).replace(/-+$/g, "");

// Moves `color` toward `target` in 5% steps until it reaches `floor` against `bg`; null if it never does.
function reach(color: string, target: string, bg: string, floor: number): string | null {
  for (let amount = 0; amount <= 1.0001; amount += 0.05) {
    const candidate = mix(target, color, amount);
    if (contrast(candidate, bg) >= floor) return candidate;
  }
  return null;
}

/**
 * Maps the 16 ANSI colors to our palette roles. Returns null when the theme cannot meet the
 * extension's readability floors (text 4.5:1, accent 3:1) or is malformed.
 */
export function convertTheme(
  text: string,
  fallback: Partial<ThemeMeta> = {},
  reservedIds: ReadonlySet<string> = new Set(),
): Converted | null {
  const { meta: found, colors } = parseTerminalTheme(text);
  const meta = { ...fallback, ...found };
  // The file's own license line is authoritative; anything not clearly permissive is skipped.
  if (meta.license) meta.license = normalizeLicense(meta.license);
  if (!meta.license || !PERMISSIVE.has(meta.license)) return null;
  const bg = colors.background;
  const fg = colors.foreground;
  const [red, green, yellow, blue, purple, cyan] = [1, 2, 3, 4, 5, 6].map((i) => colors[`color${i}`]);
  if (!meta.name || !meta.license || !bg || !fg || ![red, green, yellow, blue, purple, cyan].every(Boolean)) return null;
  if (contrast(fg, bg) < 4.5) return null;
  const dark = contrast(bg, "#000000") < contrast(bg, "#ffffff");
  const accent = [blue, colors.color12, cyan, purple, green].find((color) => color && contrast(color, bg) >= 3);
  if (!accent) return null;
  const mutedSource = colors.color8 && contrast(colors.color8, bg) >= 4.5 ? colors.color8 : mix(fg, bg, 0.7);
  const fgMuted = contrast(mutedSource, bg) >= 4.5 ? mutedSource : reach(mutedSource, fg, bg, 4.5);
  if (!fgMuted) return null;
  const border = reach(mix(fg, bg, 0.2), fg, bg, 1.1);
  if (!border) return null;
  const selection = colors.selection_background;
  const palette: Theme["palette"] = {
    bg,
    fg,
    fgMuted,
    border,
    accent,
    red,
    orange: mix(yellow, red, 0.5),
    yellow,
    green,
    cyan,
    blue,
    purple,
    pink: colors.color13 ?? purple,
    ...(selection && selection !== bg ? { selection } : {}),
  };
  const id = themeId(meta.name);
  if (!THEME_ID_PATTERN.test(id) || reservedIds.has(id)) return null;
  try {
    const theme = validateTheme({ id, name: meta.name.slice(0, MAX_NAME), mode: dark ? "dark" : "light", palette });
    return { theme, meta: { name: meta.name, author: meta.author ?? "", license: meta.license, upstream: meta.upstream ?? "" } };
  } catch {
    return null;
  }
}

