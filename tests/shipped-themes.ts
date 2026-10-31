import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerBuiltinIds } from "../src/ts/features/themes/builtins";
import { validateTheme, type Theme } from "../src/ts/features/themes/theme";

const ORDER = [
  "dracula", "alucard", "one-dark", "monokai", "catppuccin-mocha", "catppuccin-latte", "nord",
  "tokyo-night", "gruvbox-dark", "gruvbox-light", "solarized-dark", "solarized-light", "ayu-dark", "rose-pine",
];
const root = join(__dirname, "..", "assets", "themes");

/** The hand-tuned built-in themes (the theme files without an upstream field), read from disk. */
export const BUILTIN_THEMES: readonly Theme[] = readdirSync(root)
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .map((file) => JSON.parse(readFileSync(join(root, file), "utf8")))
  .filter((file) => !("upstream" in file))
  .map((file) => validateTheme(file))
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

// The app registers shipped ids when it reads the index; tests that mount them do it here.
registerBuiltinIds(BUILTIN_THEMES.map((theme) => theme.id));
