import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@rstest/core";

const root = join(__dirname, "..");
const cssRoot = join(root, "src/css");
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/primer-tokens.json"), "utf8"),
) as { tokens: string[]; allowedLiterals: string[] };
const tokens = new Set(fixture.tokens);

const EXTRA_ALLOWED = new Set<string>([
  // github.com layout variable (sticky header height), not a Primer color token
  // (unverified on github.com; every use in the CSS keeps a `0px` fallback)
  "--base-sticky-header-height",
  // Primer size tokens (base/size), outside the color token fixture
  "--base-size-4",
  "--base-size-8",
  "--base-size-24",
  "--base-size-32",
  // Primer border radius tokens (functional/size/radius.css), outside the fixture
  "--borderRadius-small",
  "--borderRadius-medium",
  // Primer border width and font stack tokens, outside the color fixture
  "--borderWidth-thin",
  "--fontStack-monospace",
]);

const PRIMER_PREFIXES = [
  "--fgColor", "--bgColor", "--borderColor", "--shadow", "--overlay",
  "--button", "--control", "--focus", "--header", "--selection", "--base",
  "--borderRadius", "--borderWidth", "--fontStack", "--text", "--motion", "--stack", "--card",
];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : e.name.endsWith(".css")
        ? [join(dir, e.name)]
        : [],
  );

const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const files = walk(cssRoot).map((path) => ({
  name: path.slice(root.length + 1),
  lines: stripComments(readFileSync(path, "utf8")).split("\n"),
}));

const scan = (re: RegExp, accept: (m: RegExpExecArray) => boolean) =>
  files.flatMap(({ name, lines }) =>
    lines.flatMap((line, i) =>
      [...line.matchAll(re)]
        .filter((m) => !accept(m as RegExpExecArray))
        .map((m) => `${name}:${i + 1}: ${m[0]}`),
    ),
  );

test("css uses only known Primer variables", () => {
  const offenders = scan(/var\(\s*(--[\w-]+)/g, (m) => {
    const name = m[1];
    if (name.startsWith("--gha-") || EXTRA_ALLOWED.has(name)) return true;
    if (!PRIMER_PREFIXES.some((p) => name.startsWith(p))) return true;
    return tokens.has(name);
  });
  expect(offenders).toEqual([]);
});

test("css has no color literals outside the allowlist", () => {
  const allowed = new Set(fixture.allowedLiterals);
  const offenders = scan(
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g,
    (m) => allowed.has(m[0]),
  );
  expect(offenders).toEqual([]);
});

test("go-to-top tooltip uses the Primer tooltip pair", () => {
  const css = stripComments(
    readFileSync(join(cssRoot, "go-to-top.css"), "utf8"),
  );
  const rule = css.match(/::after\s*\{[^}]*\}/)?.[0] ?? "";
  expect(rule).toContain("background: var(--bgColor-emphasis)");
  expect(rule).toContain("color: var(--fgColor-onEmphasis)");
  expect(rule).toContain("box-shadow: var(--shadow-floating-small)");
});

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.>[\]="()*^$|+?{}\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`);
  return css.match(re)?.[1] ?? "";
}

function hoverIsStrict(hover: string): boolean {
  if (!/background-image:\s*linear-gradient\(var\(--control-transparent-bgColor-hover\)/.test(hover))
    return false;
  if (/(?:^|[;\s])background:/.test(hover)) return false;
  const bgColors = [...hover.matchAll(/background-color:\s*([^;]+)/g)].map((m) => m[1].trim());
  return bgColors.every((v) => v === "var(--bgColor-muted)");
}

test("hover checker rejects replacing or overriding the muted fill", () => {
  const good = "background-image: linear-gradient(var(--control-transparent-bgColor-hover), var(--control-transparent-bgColor-hover));";
  expect(hoverIsStrict(good)).toBe(true);
  expect(hoverIsStrict("background: var(--bgColor-muted);")).toBe(false);
  expect(hoverIsStrict("background: var(--control-transparent-bgColor-hover);")).toBe(false);
  expect(hoverIsStrict(good + " background: var(--bgColor-muted);")).toBe(false);
  expect(hoverIsStrict(good + " background-color: transparent;")).toBe(false);
  expect(hoverIsStrict(good + " background-color: var(--bgColor-muted);")).toBe(true);
});

test("run-list card is a muted surface distinct from the page, with a visible hover", () => {
  const css = stripComments(
    readFileSync(join(cssRoot, "run-list.css"), "utf8"),
  );
  const card = ruleBody(css, ".gha-run-card-list > .gha-run-card");
  const hover = ruleBody(css, ".gha-run-card-list > .gha-run-card:hover");
  const list = ruleBody(css, '.gha-run-card-list[data-listview-component="items-list"]');
  const bg = (body: string) =>
    body.match(/background(?:-color)?:\s*var\((--bgColor-[\w-]+)\)/)?.[1];

  const cardBg = bg(card);
  expect(cardBg).toBeTruthy();
  expect(cardBg).not.toBe(bg(list) ?? "--bgColor-default");
  expect(card).toMatch(/background-color:\s*var\(--bgColor-muted\)/);
  expect(card).toMatch(/border(?:-color)?:[^;]*var\(--borderColor-[\w-]+\)/);
  expect(hoverIsStrict(hover)).toBe(true);
  expect(card + hover).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
});
