/**
 * Turns a Theme into the CSS variables, and the scoped stylesheet, that override GitHub's Primer
 * tokens.
 */
import { contrast, formatColor, mix, parseColor, withAlpha } from "./color";
import {
  resolvePalette,
  type ResolvedPalette,
  type Theme,
  type ThemeMode,
} from "./theme";

const WHITE = "#ffffff";
const BLACK = "#000000";
const MIN_CONTRAST = 4.5;
const STEPS = 20;

interface Context {
  p: ResolvedPalette;
  dark: boolean;
  onEmphasis: string;
  emphasis: Record<string, string>;
  ensure: (start: string) => string;
}

type Rule = (ctx: Context) => string;
type Row = [name: string, rule: Rule];
type HueRole = "accent" | "green" | "yellow" | "orange" | "red" | "purple" | "pink";

function normalize(value: string): string {
  const color = parseColor(value);
  if (!color) throw new Error(`Invalid color: ${value}`);
  return formatColor(color);
}

// Mix start toward the pole opposite to text in 5% steps; a start that already passes is kept.
// `steps` is how far start had to move (0 means it already passes); pickOnEmphasis uses it as a
// cost.
function ensureContrast(start: string, text: string): { value: string; steps: number } {
  const pole = contrast(text, BLACK) >= contrast(text, WHITE) ? BLACK : WHITE;
  for (let steps = 0; steps < STEPS; steps++) {
    const value = mix(pole, start, steps / STEPS);
    if (contrast(text, value) >= MIN_CONTRAST) return { value, steps };
  }
  // No mix reached the ratio, so the pole itself is the best available fill.
  return { value: pole, steps: STEPS };
}

// Raw fill colors before adjustment; generateVariables later nudges each until the shared on-
// emphasis text reads on it.
function emphasisStarts(p: ResolvedPalette): Record<string, string> {
  return {
    default: mix(p.fg, p.bg, 0.2),
    neutral: normalize(p.fgMuted),
    ...Object.fromEntries(FAMILIES.map(([family, role]) => [family, normalize(p[role])])),
  };
}

// One on-emphasis text per theme: white or bg, whichever needs the fewest adjustment steps.
// One shared color keeps buttons, labels and badges consistent inside a theme. The candidate that
// moves the fills least wins, so they stay close to the palette's own hues.
function pickOnEmphasis(p: ResolvedPalette, starts: string[]): string {
  const cost = (text: string) =>
    starts.reduce((sum, start) => sum + ensureContrast(start, text).steps, 0);
  const bg = normalize(p.bg);
  // A tie goes to white.
  return cost(bg) < cost(WHITE) ? bg : WHITE;
}

// Canvas, controls, overlay, header.
const BACKGROUNDS: Row[] = [
  ["--bgColor-default", ({ p }) => normalize(p.bg)],
  ["--bgColor-muted", ({ p }) => normalize(p.bgAlt)],
  ["--bgColor-inset", ({ p }) => normalize(p.bgInset)],
  ["--bgColor-emphasis", ({ emphasis }) => emphasis.default],
  ["--bgColor-inverse", ({ p }) => normalize(p.fg)],
  ["--bgColor-disabled", ({ p }) => normalize(p.bgAlt)],
  ["--bgColor-neutral-muted", ({ p, dark }) => withAlpha(p.fgMuted, dark ? 0.2 : 0.12)],
  ["--bgColor-neutral-emphasis", ({ emphasis }) => emphasis.neutral],
  ["--control-bgColor-rest", ({ p }) => normalize(p.bgAlt)],
  ["--control-bgColor-hover", ({ p }) => mix(p.fg, p.bgAlt, 0.04)],
  ["--control-bgColor-active", ({ p }) => mix(p.fg, p.bgAlt, 0.08)],
  ["--controlTrack-bgColor-rest", ({ p }) => normalize(p.bgInset)],
  ["--overlay-bgColor", ({ p, dark }) => normalize(dark ? p.bgInset : p.bg)],
  ["--overlay-backdrop-bgColor", ({ p }) => withAlpha(p.bgInset, 0.4)],
  ["--header-bgColor", ({ p, dark }) => dark ? withAlpha(p.bgAlt, 0.95) : normalize(p.fg)],
];

// Foreground colors.
const FOREGROUNDS: Row[] = [
  ["--fgColor-default", ({ p }) => normalize(p.fg)],
  ["--fgColor-muted", ({ p }) => normalize(p.fgMuted)],
  ["--fgColor-neutral", ({ p }) => normalize(p.fgMuted)],
  ["--fgColor-disabled", ({ p }) => mix(p.fg, p.bg, 0.4)],
  ["--fgColor-onEmphasis", ({ onEmphasis }) => onEmphasis],
  ["--fgColor-onInverse", ({ p }) => normalize(p.bg)],
  ["--fgColor-white", () => WHITE],
  ["--fgColor-black", ({ p, dark }) => normalize(dark ? p.bgInset : p.fg)],
];

// Borders; Primer alpha bytes 0xb3 / 0x1a / 0x26.
const BORDERS: Row[] = [
  ["--borderColor-default", ({ p }) => normalize(p.border)],
  ["--borderColor-muted", ({ p }) => withAlpha(p.border, 0.7)],
  ["--borderColor-emphasis", ({ p }) => mix(p.fg, p.bg, 0.4)],
  ["--borderColor-disabled", ({ p }) => withAlpha(p.border, 0.1)],
  ["--borderColor-translucent", ({ p }) => withAlpha(p.fg, 0.15)],
];

// Dark -muted alphas: 10% accent/danger/severe/sponsors, 15% success/attention/done.
const FAMILIES: [family: string, role: HueRole, darkAlpha: number][] = [
  ["accent", "accent", 0.1],
  ["success", "green", 0.15],
  ["attention", "yellow", 0.15],
  ["severe", "orange", 0.1],
  ["danger", "red", 0.1],
  ["done", "purple", 0.15],
  ["sponsors", "pink", 0.1],
];

// Family text must read on the canvas; emphasis and syntax keep the raw hue.
const familyText = (p: ResolvedPalette, role: HueRole) => ensureContrast(normalize(p[role]), normalize(p.bg)).value;

function familyRows([family, role, darkAlpha]: (typeof FAMILIES)[number]): Row[] {
  const rows: Row[] = [
    [`--fgColor-${family}`, ({ p }) => familyText(p, role)],
    [`--bgColor-${family}-muted`, ({ p, dark }) => dark ? withAlpha(p[role], darkAlpha) : mix(p[role], p.bg, 0.12)],
    [`--bgColor-${family}-emphasis`, ({ emphasis }) => emphasis[family]],
    [`--borderColor-${family}-muted`, ({ p }) => withAlpha(p[role], 0.4)],
    [`--borderColor-${family}-emphasis`, ({ emphasis }) => emphasis[family]],
  ];
  if (family === "accent") rows.push(["--fgColor-link", ({ p }) => familyText(p, role)]);
  return rows;
}

// Danger button text sits on control-bgColor-rest inside the page; it must read on both.
const dangerButtonText = (p: ResolvedPalette) =>
  ensureContrast(familyText(p, "red"), normalize(p.bgAlt)).value;

// Hover and active move the emphasis 8%/16% toward fg (kept readable); disabled is 40% alpha.
const CONTROLS: Row[] = [
  ["--button-primary-bgColor-rest", ({ emphasis }) => emphasis.success],
  ["--button-primary-bgColor-hover", ({ p, emphasis, ensure }) => ensure(mix(p.fg, emphasis.success, 0.08))],
  ["--button-primary-bgColor-active", ({ p, emphasis, ensure }) => ensure(mix(p.fg, emphasis.success, 0.16))],
  ["--button-primary-bgColor-disabled", ({ emphasis }) => withAlpha(emphasis.success, 0.4)],
  ["--button-primary-fgColor-rest", ({ onEmphasis }) => onEmphasis],
  ["--button-primary-iconColor-rest", ({ onEmphasis }) => onEmphasis],
  ["--control-checked-bgColor-hover", ({ p, emphasis, ensure }) => ensure(mix(p.fg, emphasis.accent, 0.08))],
  ["--button-danger-fgColor-rest", ({ p }) => dangerButtonText(p)],
  ["--selection-bgColor", ({ p }) => normalize(p.selection)],
];

type Layer = [y: number, blur: number, spread: number, dark: number, light: number];
type Shadow = [name: string, ring: [dark: number, light: number] | null, layers: Layer[], inset?: boolean];

// Primer's shadow geometry and alpha steps (dark / light).
const SHADOWS: Shadow[] = [
  ["--shadow-resting-xsmall", null, [[1, 1, 0, 0.8, 0.05]]],
  ["--shadow-resting-small", null, [[1, 1, 0, 0.6, 0.04], [1, 3, 0, 0.6, 0.03]]],
  ["--shadow-resting-medium", null, [[1, 1, 0, 0.4, 0.1], [3, 6, 0, 0.8, 0.12]]],
  ["--shadow-floating-small", [1, 0.25], [[6, 12, -3, 0.4, 0.04], [6, 18, 0, 0.4, 0.12]]],
  ["--shadow-floating-medium", [1, 0], [[8, 16, -4, 0.4, 0.08], [4, 32, -4, 0.4, 0.08], [24, 48, -12, 0.4, 0.08], [48, 96, -24, 0.4, 0.08]]],
  ["--shadow-floating-large", [1, 0], [[24, 48, 0, 1, 0.24]]],
  ["--shadow-floating-xlarge", [1, 0], [[32, 64, 0, 1, 0.32]]],
  ["--shadow-inset", null, [[1, 0, 0, 0.24, 0.04]], true],
];

const px = (n: number) => (n === 0 ? "0" : `${n}px`);

function shadowRow([name, ring, layers, inset]: Shadow): Row {
  return [
    name,
    ({ p, dark }) => {
      const color = dark ? p.bgInset : p.fg;
      const parts = layers.map(
        ([y, blur, spread, a, b]) =>
          `${inset ? "inset " : ""}0 ${px(y)} ${px(blur)} ${px(spread)} ${withAlpha(color, dark ? a : b)}`,
      );
      if (ring) parts.unshift(`0 0 0 1px ${withAlpha(p.border, dark ? ring[0] : ring[1])}`);
      return parts.join(", ");
    },
  ];
}

// Syntax mapping: [root suffix, --color-prettylights alias suffix, rule].
const SYNTAX: [root: string, alias: string, rule: Rule][] = [
  ["comment", "comment", ({ p }) => normalize(p.comment)],
  ["constant", "constant", ({ p }) => normalize(p.syntax.constant)],
  ["constantOtherReferenceLink", "constant-other-reference-link", ({ p }) => normalize(p.syntax.string)],
  ["entity", "entity", ({ p }) => normalize(p.syntax.function)],
  ["storageModifierImport", "storage-modifier-import", ({ p }) => normalize(p.fg)],
  ["entityTag", "entity-tag", ({ p }) => normalize(p.syntax.tag)],
  ["keyword", "keyword", ({ p }) => normalize(p.syntax.keyword)],
  ["string", "string", ({ p }) => normalize(p.syntax.string)],
  ["variable", "variable", ({ p }) => normalize(p.syntax.variable)],
  ["bracketHighlighterUnmatched", "brackethighlighter-unmatched", ({ p }) => normalize(p.red)],
  ["bracketHighlighterAngle", "brackethighlighter-angle", ({ p }) => normalize(p.fgMuted)],
  ["invalidIllegal-text", "invalid-illegal-text", ({ p }) => normalize(p.red)],
  ["invalidIllegal-bg", "invalid-illegal-bg", ({ p, dark }) => dark ? withAlpha(p.red, 0.1) : mix(p.red, p.bg, 0.12)],
  ["carriageReturn-text", "carriage-return-text", ({ onEmphasis }) => onEmphasis],
  ["carriageReturn-bg", "carriage-return-bg", ({ emphasis }) => emphasis.danger],
  ["stringRegexp", "string-regexp", ({ p }) => normalize(p.syntax.tag)],
  ["markup-list", "markup-list", ({ p }) => normalize(p.yellow)],
  ["markup-heading", "markup-heading", ({ p }) => normalize(p.syntax.constant)],
  ["markup-italic", "markup-italic", ({ p }) => normalize(p.fg)],
  ["markup-bold", "markup-bold", ({ p }) => normalize(p.fg)],
  ["markup-deleted-text", "markup-deleted-text", ({ p }) => normalize(p.red)],
  ["markup-deleted-bg", "markup-deleted-bg", ({ p }) => withAlpha(p.red, 0.15)],
  ["markup-inserted-text", "markup-inserted-text", ({ p }) => normalize(p.green)],
  ["markup-inserted-bg", "markup-inserted-bg", ({ p }) => withAlpha(p.green, 0.15)],
  ["markup-changed-text", "markup-changed-text", ({ p }) => normalize(p.orange)],
  ["markup-changed-bg", "markup-changed-bg", ({ p }) => withAlpha(p.orange, 0.15)],
  ["markup-ignored-text", "markup-ignored-text", ({ p }) => normalize(p.fg)],
  ["markup-ignored-bg", "markup-ignored-bg", ({ p }) => withAlpha(p.blue, 0.15)],
  ["metaDiffRange", "meta-diff-range", ({ p }) => normalize(p.syntax.constant)],
  ["sublimeLinterGutterMark", "sublimelinter-gutter-mark", ({ p }) => normalize(p.border)],
];

const syntaxRows = SYNTAX.flatMap(([root, alias, rule]): Row[] => [
  [`--prettylights-syntax-${root}`, rule],
  [`--color-prettylights-syntax-${alias}`, rule],
]);

const ROWS: Row[] = [
  ...BACKGROUNDS,
  ...FOREGROUNDS,
  ...BORDERS,
  ...FAMILIES.flatMap(familyRows),
  ...CONTROLS,
  ...SHADOWS.map(shadowRow),
  ...syntaxRows,
];

/**
 * Maps every Primer variable we override to a value derived from the theme's palette. Expects a
 * validated theme (an invalid color throws).
 */
export function generateVariables(theme: Theme): Record<string, string> {
  const p = resolvePalette(theme.palette, theme.mode);
  const starts = emphasisStarts(p);
  const onEmphasis = pickOnEmphasis(p, Object.values(starts));
  // Every emphasis fill is adjusted against the single onEmphasis text, so it reads at 4.5:1 on
  // all of them where that is reachable.
  const ensure = (start: string) => ensureContrast(start, onEmphasis).value;
  const ctx: Context = {
    p,
    dark: theme.mode === "dark",
    onEmphasis,
    emphasis: Object.fromEntries(
      Object.entries(starts).map(([key, start]) => [key, ensure(start)]),
    ),
    ensure,
  };
  return Object.fromEntries(ROWS.map(([name, rule]) => [name, rule(ctx)]));
}

const MODES: ThemeMode[] = ["light", "dark"];

/**
 * Element plus three attribute selectors gives specificity (0,3,1). We rely on that outranking the
 * selectors Primer scopes its theme variables with, so no !important is needed.
 */
function selector(colorMode: string): string {
  return `html[data-color-mode="${colorMode}"][data-light-theme][data-dark-theme]`;
}

function declarations(lines: string[], indent: string): string {
  return lines.map((line) => `${indent}${line}`).join("\n");
}

// A fixed mode matches data-color-mode directly. For "auto" (Sync with system) the same
// declarations sit in a prefers-color-scheme query, so the theme of the mode the OS currently
// prefers applies. color-scheme makes native controls and scrollbars follow the mode.
function modeBlock(mode: ThemeMode, theme: Theme): string {
  // Sorted so the output does not depend on row order.
  const vars = Object.entries(generateVariables(theme)).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const lines = [`color-scheme: ${mode};`, ...vars.map(([n, v]) => `${n}: ${v};`)];
  return [
    `${selector(mode)} {`,
    declarations(lines, "  "),
    "}",
    `@media (prefers-color-scheme: ${mode}) {`,
    `  ${selector("auto")} {`,
    declarations(lines, "    "),
    "  }",
    "}",
  ].join("\n");
}

/**
 * Returns "" when neither mode has an Active theme; a mode without a theme gets no block, so
 * GitHub's own colors apply there.
 */
export function generateStylesheet(active: {
  light?: Theme;
  dark?: Theme;
}): string {
  const blocks = MODES.flatMap((mode) => {
    const theme = active[mode];
    return theme ? [modeBlock(mode, theme)] : [];
  });
  if (!blocks.length) return "";
  return `${blocks.join("\n")}\n`;
}
