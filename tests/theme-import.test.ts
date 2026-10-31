import { expect, test } from "@rstest/core";
import { convertTheme, nameKey, parseTerminalTheme, PERMISSIVE, themeId } from "../src/ts/features/themes/themeImport";

const DRACULA = `## name: Dracula
## author: Someone
## license: MIT
## upstream: https://example.test/dracula.conf
foreground #f8f8f2
background #282a36
selection_background #44475a
color8  #6272a4
color1  #ff5555
color2  #50fa7b
color3  #f1fa8c
color4  #bd93f9
color5  #ff79c6
color6  #8be9fd
color13 #ff92df
color12 #d6acff
`;

test("parses metadata and colors", () => {
  const { meta, colors } = parseTerminalTheme(DRACULA);
  expect(meta).toMatchObject({ name: "Dracula", license: "MIT" });
  expect(colors.background).toBe("#282a36");
  expect(colors.color13).toBe("#ff92df");
});

test("converts a dark terminal theme to a valid theme", () => {
  const result = convertTheme(DRACULA)!;
  expect(result.theme).toMatchObject({ id: "dracula", name: "Dracula", mode: "dark" });
  expect(result.theme.palette).toMatchObject({ bg: "#282a36", fg: "#f8f8f2", red: "#ff5555", pink: "#ff92df" });
  expect(result.meta).toMatchObject({ license: "MIT", upstream: "https://example.test/dracula.conf" });
});

test("detects light themes and rejects low contrast or incomplete themes", () => {
  const light = `## name: Paper
## license: MIT
foreground #073642
background #fdf6e3
color1 #dc322f
color2 #5c6b00
color3 #8a6a00
color4 #268bd2
color5 #d33682
color6 #1f7a70
`;
  expect(convertTheme(light)!.theme.mode).toBe("light");
  // Bright terminal colors on a light background cannot meet the accent floor.
  expect(convertTheme(DRACULA.replace("#282a36", "#fdf6e3").replace("#f8f8f2", "#073642"))).toBeNull();
  expect(convertTheme(DRACULA.replace("#f8f8f2", "#2b2d3a"))).toBeNull();
  expect(convertTheme(DRACULA.replace("color6  #8be9fd\n", ""))).toBeNull();
  expect(convertTheme(DRACULA.replace("## license: MIT\n", ""))).toBeNull();
  expect(convertTheme(DRACULA.replace("MIT", "GPL-3.0"))).toBeNull();
  expect(convertTheme(DRACULA.replace("MIT", "CC0 1.0"))!.meta.license).toBe("CC0-1.0");
});

test("a reserved id is rejected", () => {
  expect(convertTheme(DRACULA, {}, new Set(["dracula"]))).toBeNull();
});

test("id, name key and license helpers", () => {
  expect(themeId("Tokyo Night (Storm)")).toBe("tokyo-night-storm");
  expect(nameKey("Gruvbox  Dark!")).toBe("gruvboxdark");
  expect(PERMISSIVE.has("MIT")).toBe(true);
  expect(PERMISSIVE.has("GPL-3.0")).toBe(false);
});
