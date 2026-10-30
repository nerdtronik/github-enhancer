/**
 * Theme model: palette types, validation of untrusted input, palette defaults and the export/import
 * envelope.
 */
import { THEME_ID_PATTERN } from "../../core/definitions";
import { mix, parseColor, withAlpha } from "./color";

export type ThemeMode = "light" | "dark";

export const SYNTAX_KEYS = [
  "keyword",
  "function",
  "constant",
  "string",
  "tag",
  "variable",
] as const;

export type SyntaxKey = (typeof SYNTAX_KEYS)[number];

export interface Palette {
  bg: string;
  fg: string;
  fgMuted: string;
  border: string;
  accent: string;
  red: string;
  orange: string;
  yellow: string;
  green: string;
  cyan: string;
  blue: string;
  purple: string;
  pink: string;
  bgAlt?: string;
  bgInset?: string;
  comment?: string;
  selection?: string;
  syntax?: Partial<Record<SyntaxKey, string>>;
}

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  palette: Palette;
}

export type ResolvedPalette = Required<Omit<Palette, "syntax">> & {
  syntax: Required<NonNullable<Palette["syntax"]>>;
};

type RequiredRole = Exclude<
  keyof Palette,
  "bgAlt" | "bgInset" | "comment" | "selection" | "syntax"
>;

export const ROLES: readonly RequiredRole[] = [
  "bg",
  "fg",
  "fgMuted",
  "border",
  "accent",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
];

const OPTIONAL_ROLES = ["bgAlt", "bgInset", "comment", "selection"] as const;

const MAX_THEMES = 200;
const MAX_ID = 64;
export const MAX_NAME = 60;
const FORMAT = "gha-themes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Colors must pass parseColor (hex only); nothing else is accepted into a palette.
function readColor(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !parseColor(value)) {
    throw new Error(`Invalid color for "${key}"`);
  }
  return value;
}

function validateId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_ID ||
    !THEME_ID_PATTERN.test(value)
  ) {
    throw new Error(`Invalid theme id: ${String(value)}`);
  }
  return value;
}

function validateName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME) {
    throw new Error(`Invalid theme name: must be 1-${MAX_NAME} characters`);
  }
  return name;
}

function validateSyntax(value: unknown): Palette["syntax"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('Invalid "syntax": expected an object');
  const syntax: Partial<Record<SyntaxKey, string>> = {};
  for (const key of SYNTAX_KEYS) {
    if (value[key] !== undefined) syntax[key] = readColor(value, key);
  }
  return syntax;
}

function validatePalette(value: unknown): Palette {
  if (!isRecord(value)) throw new Error('Invalid "palette": expected an object');
  const palette = {} as Palette;
  for (const role of ROLES) palette[role] = readColor(value, role);
  for (const role of OPTIONAL_ROLES) {
    if (value[role] !== undefined) palette[role] = readColor(value, role);
  }
  const syntax = validateSyntax(value.syntax);
  if (syntax) palette.syntax = syntax;
  return palette;
}

/**
 * Validates untrusted input (storage, imported files); throws an Error with a user-facing message.
 * Only whitelisted fields survive: a slug id, a trimmed name and hex colors. The name is still
 * never markup: render it with textContent only.
 */
export function validateTheme(value: unknown): Theme {
  if (!isRecord(value)) throw new Error("Invalid theme: expected an object");
  if (value.mode !== "light" && value.mode !== "dark") {
    throw new Error('Invalid "mode": expected "light" or "dark"');
  }
  return {
    id: validateId(value.id),
    name: validateName(value.name),
    mode: value.mode,
    palette: validatePalette(value.palette),
  };
}

/**
 * Fills the optional roles from the required ones; generator, preview and editor all read palettes
 * through this.
 */
export function resolvePalette(
  palette: Palette,
  mode: ThemeMode,
): ResolvedPalette {
  const dark = mode === "dark";
  const bgAlt = palette.bgAlt ?? mix(palette.fg, palette.bg, 0.04);
  return {
    ...palette,
    bgAlt,
    bgInset: palette.bgInset ?? (dark ? mix("#000000", palette.bg, 0.25) : bgAlt),
    comment: palette.comment ?? palette.fgMuted,
    selection: palette.selection ?? withAlpha(palette.accent, dark ? 0.7 : 0.2),
    syntax: {
      keyword: palette.pink,
      function: palette.green,
      constant: palette.purple,
      string: palette.yellow,
      tag: palette.cyan,
      variable: palette.orange,
      ...palette.syntax,
    },
  };
}

/**
 * Random rather than name-based, so renaming does not change identity and a collision is
 * unlikely (importThemes still checks). Matches THEME_ID_PATTERN.
 */
export function createThemeId(): string {
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => (byte % 36).toString(36),
  ).join("");
  return `custom-${suffix}`;
}

export function exportThemes(themes: Theme[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, themes }, null, 2);
}

function parseEnvelope(text: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid file: not valid JSON");
  }
  if (!isRecord(data) || data.format !== FORMAT) {
    throw new Error(`Invalid file: format must be "${FORMAT}"`);
  }
  if (!Array.isArray(data.themes)) {
    throw new Error('Invalid file: "themes" must be an array');
  }
  if (data.themes.length > MAX_THEMES) {
    throw new Error(`Invalid file: more than ${MAX_THEMES} themes`);
  }
  return data.themes;
}

function freshId(taken: Set<string>): string {
  let id = createThemeId();
  while (taken.has(id)) id = createThemeId();
  return id;
}

/**
 * Merges an export file into `existing`. A name match (ignoring case) replaces that theme and keeps
 * its id, so an Active theme stays active. A new theme whose id is in `reserved` or already taken
 * gets a fresh id. Throws before changing anything if the file or any theme is invalid.
 */
export function importThemes(
  text: string,
  existing: Theme[],
  reserved: Iterable<string> = [],
): { themes: Theme[]; added: number; replaced: number } {
  const incoming = parseEnvelope(text).map(validateTheme);
  const themes = [...existing];
  const taken = new Set([...reserved, ...existing.map((t) => t.id)]);
  let added = 0;
  let replaced = 0;
  for (const theme of incoming) {
    const index = themes.findIndex(
      (t) => t.name.toLowerCase() === theme.name.toLowerCase(),
    );
    if (index >= 0) {
      themes[index] = { ...theme, id: themes[index].id };
      replaced++;
      continue;
    }
    const id = taken.has(theme.id) ? freshId(taken) : theme.id;
    taken.add(id);
    themes.push({ ...theme, id });
    added++;
  }
  return { themes, added, replaced };
}
