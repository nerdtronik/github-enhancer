import { expect, test } from "@rstest/core";
import { contrast, mix, parseColor } from "../src/ts/features/themes/color";
import { BUILTIN_THEMES } from "./shipped-themes";
import {
  generateStylesheet,
  generateVariables,
} from "../src/ts/features/themes/generate";
import { validateTheme, type Theme } from "../src/ts/features/themes/theme";
import alucard from "./fixtures/themes/alucard.json";
import dracula from "./fixtures/themes/dracula.json";
import nord from "./fixtures/themes/nord.json";
import oneDark from "./fixtures/themes/one-dark.json";
import solarizedLight from "./fixtures/themes/solarized-light.json";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const dark = (): Theme => validateTheme(clone(dracula));
const light = (): Theme => validateTheme(clone(alucard));

const FIXTURES: Record<string, unknown> = {
  dracula,
  "one-dark": oneDark,
  nord,
  alucard,
  "solarized-light": solarizedLight,
};

const FAMILIES = [
  "accent", "success", "attention", "severe", "danger", "done", "sponsors",
];

test("generateVariables maps the Dracula palette onto Primer roots", () => {
  const vars = generateVariables(dark());
  expect(vars["--bgColor-default"]).toBe("#282a36");
  expect(vars["--bgColor-muted"]).toBe("#21222c");
  expect(vars["--fgColor-default"]).toBe("#f8f8f2");
  expect(vars["--fgColor-muted"]).toBe("#b6b8c4");
  expect(vars["--fgColor-neutral"]).toBe("#b6b8c4");
  expect(vars["--fgColor-success"]).toBe("#50fa7b");
  expect(vars["--bgColor-success-muted"]).toBe("#50fa7b26");
  expect(vars["--bgColor-danger-muted"]).toBe("#ff55551a");
  expect(vars["--borderColor-success-muted"]).toBe("#50fa7b66");
  expect(vars["--borderColor-muted"]).toBe("#44475ab3");
  expect(vars["--fgColor-onEmphasis"]).toBe("#282a36");
  expect(vars["--prettylights-syntax-keyword"]).toBe("#ff79c6");
  expect(vars["--color-prettylights-syntax-keyword"]).toBe("#ff79c6");
});

test("danger emphasis stays the hue when the theme bg reads on it", () => {
  const vars = generateVariables(dark());
  expect(vars["--bgColor-danger-emphasis"]).toBe("#ff5555");
  expect(vars["--borderColor-danger-emphasis"]).toBe("#ff5555");
});

const ALL_THEMES: [string, Theme][] = [
  ...Object.entries(FIXTURES).map(([id, data]): [string, Theme] => [`fixture ${id}`, validateTheme(clone(data))]),
  ...BUILTIN_THEMES.map((theme): [string, Theme] => [theme.id, theme]),
];

for (const [id, theme] of ALL_THEMES) {
  test(`${id}: every family foreground reads on the background`, () => {
    const vars = generateVariables(theme);
    for (const family of FAMILIES) {
      const ratio = contrast(vars[`--fgColor-${family}`], theme.palette.bg);
      expect({ family, ok: ratio >= 4.5 }).toEqual({ family, ok: true });
    }
    expect(vars["--fgColor-link"]).toBe(vars["--fgColor-accent"]);
  });

  test(`${id}: danger button text reads on the page and control backgrounds`, () => {
    const vars = generateVariables(theme);
    const text = vars["--button-danger-fgColor-rest"];
    for (const name of ["--bgColor-default", "--control-bgColor-rest"]) {
      expect({ name, ok: contrast(text, vars[name]) >= 4.5 }).toEqual({ name, ok: true });
    }
  });
}

test("danger button text keeps the hue when it already reads", () => {
  expect(generateVariables(dark())["--button-danger-fgColor-rest"]).toBe("#ff5555");
});

test("family foregrounds keep the hue when it already reads", () => {
  const vars = generateVariables(dark());
  expect(vars["--fgColor-danger"]).toBe("#ff5555");
  expect(vars["--fgColor-done"]).toBe("#bd93f9");
  expect(vars["--fgColor-accent"]).toBe("#8be9fd");
});

test("syntax colors keep the raw hue on light themes", () => {
  const theme = validateTheme(clone(solarizedLight));
  const vars = generateVariables(theme);
  expect(vars["--prettylights-syntax-string"]).toBe(theme.palette.syntax?.string ?? theme.palette.yellow);
});

test("primary button icon uses the primary button text color", () => {
  const vars = generateVariables(dark());
  expect(vars["--button-primary-iconColor-rest"]).toBe("#282a36");
  for (const data of Object.values(FIXTURES)) {
    const v = generateVariables(validateTheme(clone(data)));
    expect(v["--button-primary-iconColor-rest"]).toBe(v["--button-primary-fgColor-rest"]);
  }
});

test("every semantic family gets its five variables", () => {
  const vars = generateVariables(dark());
  for (const family of FAMILIES) {
    for (const name of [
      `--fgColor-${family}`,
      `--bgColor-${family}-muted`,
      `--bgColor-${family}-emphasis`,
      `--borderColor-${family}-muted`,
      `--borderColor-${family}-emphasis`,
    ]) {
      expect(parseColor(vars[name] ?? "")).not.toBeNull();
    }
  }
});

test("every syntax root has its --color-prettylights alias with the same value", () => {
  const vars = generateVariables(dark());
  const roots = Object.keys(vars).filter((k) => k.startsWith("--prettylights-"));
  const aliases = Object.keys(vars).filter((k) =>
    k.startsWith("--color-prettylights-"),
  );
  expect(roots.length).toBe(30);
  expect(aliases.length).toBe(30);
  expect(vars["--color-prettylights-syntax-entity-tag"]).toBe(
    vars["--prettylights-syntax-entityTag"],
  );
});

test("group 9 variables are not generated", () => {
  const names = Object.keys(generateVariables(dark()));
  expect(names.some((n) => /^--(ansi|diffBlob|contribution)-/.test(n))).toBe(
    false,
  );
});

test("every value is a parseable color or a safe shadow", () => {
  for (const data of Object.values(FIXTURES)) {
    const theme = validateTheme(clone(data));
    for (const [name, value] of Object.entries(generateVariables(theme))) {
      if (name.startsWith("--shadow-")) {
        expect(value.replace(/\binset /g, "")).toMatch(/^[0-9a-f#,\spx.-]+$/);
        expect(value).not.toMatch(/[;{}<>]|url/);
        continue;
      }
      expect(parseColor(value)).not.toBeNull();
    }
  }
});

test("light themes use opaque tints for -muted backgrounds", () => {
  const theme = light();
  const vars = generateVariables(theme);
  expect(vars["--bgColor-success-muted"]).toBe(
    mix(theme.palette.green, theme.palette.bg, 0.12),
  );
  expect(vars["--bgColor-success-muted"]).toHaveLength(7);
});

test("generateStylesheet returns an empty string with no active theme", () => {
  expect(generateStylesheet({})).toBe("");
});

test("a dark-only stylesheet targets dark mode and dark auto only", () => {
  const css = generateStylesheet({ dark: dark() });
  expect(css).toContain(
    'html[data-color-mode="dark"][data-light-theme][data-dark-theme]',
  );
  expect(css).toContain("@media (prefers-color-scheme: dark)");
  expect(css).toContain(
    'html[data-color-mode="auto"][data-light-theme][data-dark-theme]',
  );
  expect(css).toContain("color-scheme: dark;");
  expect(css).toContain("--bgColor-default: #282a36;");
  expect(css).not.toContain("prefers-color-scheme: light");
  expect(css).not.toContain('data-color-mode="light"');
});

test("a light+dark stylesheet contains both mode blocks", () => {
  const css = generateStylesheet({ light: light(), dark: dark() });
  expect(css).toContain(
    'html[data-color-mode="light"][data-light-theme][data-dark-theme]',
  );
  expect(css).toContain(
    'html[data-color-mode="dark"][data-light-theme][data-dark-theme]',
  );
  expect(css).toContain("@media (prefers-color-scheme: light)");
  expect(css).toContain("@media (prefers-color-scheme: dark)");
  expect(css).toContain("color-scheme: light;");
  expect(css).toContain("color-scheme: dark;");
});

test("generateStylesheet output is stable and every block is sorted", () => {
  const active = { light: light(), dark: dark() };
  const css = generateStylesheet(active);
  expect(generateStylesheet(active)).toBe(css);
  const blocks = css
    .split(/[{}]/)
    .map((block) => [...block.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]))
    .filter((names) => names.length > 0);
  expect(blocks.length).toBe(4);
  for (const names of blocks) {
    expect(names.length).toBe(Object.keys(generateVariables(dark())).length);
    expect(names).toEqual([...names].sort());
  }
});

test("--shadow-inset is generated from the shadow color", () => {
  expect(generateVariables(dark())["--shadow-inset"]).toBe(
    "inset 0 1px 0 0 #191a213d",
  );
});

const EMPHASIS_BACKGROUNDS = [
  "--bgColor-emphasis",
  "--bgColor-neutral-emphasis",
  ...FAMILIES.map((family) => `--bgColor-${family}-emphasis`),
  "--button-primary-bgColor-hover",
  "--button-primary-bgColor-active",
  "--control-checked-bgColor-hover",
];

for (const [id, data] of Object.entries(FIXTURES)) {
  test(`${id}: --fgColor-onEmphasis reads on every emphasis background`, () => {
    const vars = generateVariables(validateTheme(clone(data)));
    for (const name of EMPHASIS_BACKGROUNDS) {
      expect({ name, ratio: contrast(vars["--fgColor-onEmphasis"], vars[name]) >= 4.5 })
        .toEqual({ name, ratio: true });
    }
    expect(vars[`--borderColor-success-emphasis`]).toBe(
      vars["--bgColor-success-emphasis"],
    );
  });

  test(`${id}: primary button text reads on the primary button`, () => {
    const vars = generateVariables(validateTheme(clone(data)));
    expect(vars["--button-primary-bgColor-rest"]).toBe(
      vars["--bgColor-success-emphasis"],
    );
    expect(vars["--button-primary-fgColor-rest"]).toBe(
      vars["--fgColor-onEmphasis"],
    );
    expect(
      contrast(
        vars["--button-primary-fgColor-rest"],
        vars["--button-primary-bgColor-rest"],
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
}

test("the theme name never reaches the stylesheet", () => {
  const name = 'a"}</style><script>x';
  const theme = validateTheme({ ...clone(dracula), name });
  const css = generateStylesheet({ dark: theme, light: theme });
  expect(css).not.toContain(name);
  expect(css).not.toContain("<");
});
