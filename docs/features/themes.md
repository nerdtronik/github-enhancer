# Themes

## How it works

The extension injects a stylesheet on every github.com page at the start of page load. It overrides GitHub's Primer color variables (and the code syntax colors) with the colors of the Active theme, so the whole interface changes. It never changes GitHub's own appearance setting.

## Modes and Active themes

A theme belongs to a Mode, light or dark. Each Mode has at most one Active theme. A theme applies when GitHub itself is in that Mode, including when GitHub is set to Sync with system and follows the OS. A Mode with no Active theme keeps GitHub's own colors.

Choose themes on `https://github.com/settings/appearance`. A **Custom themes** section is added after GitHub's own appearance form. It has a toolbar (**New dark theme**, **New light theme**, **Import**, **Export**) and two sub-sections, **Dark themes** first and **Light themes** second. Each sub-section has a header explaining how to activate its themes, a search box and a scrollable list. Every row is a chip showing the theme's background with its main colors as circles, the theme's name and a badge (**Built-in** or **Custom**). The list starts with a **GitHub default** row (GitHub's own colors in that Mode), then the Built-in themes of that Mode and your Custom themes. Picking a row makes it the Active theme for that Mode; picking **GitHub default** clears it. Typing in the search box hides the rows whose name does not match. GitHub's own theme options are not changed, and choosing one of them does not clear our Active themes.

A theme applies only while GitHub itself is in the same Mode. To use a dark theme, first select one of GitHub's dark themes above (for example "Dark default"), then choose a theme under **Dark themes**; for a light theme, select one of GitHub's light themes (for example "Light default") and choose under **Light themes**. With "Sync with system", the theme chosen under each sub-section is used for that Mode.

## Built-in themes

About 200 dark and light themes ship with the extension, all marked **Built-in**. Each one is a JSON file in `assets/themes` (packaged as `dist/themes`), and `index.json` lists them for the picker. The list is read only on the Appearance page, and a theme's full palette is loaded when it is the Active theme or when you duplicate it. Nothing is downloaded from the internet at runtime. Built-in themes cannot be edited; use **Duplicate** to turn one into a Custom theme.

Fourteen of them are hand-tuned: Dracula, Alucard, One Dark, Monokai, Catppuccin Mocha, Catppuccin Latte, Nord, Tokyo Night, Gruvbox dark, Gruvbox light, Solarized dark, Solarized light, Ayu Dark and Rosé Pine. The others are popular community themes whose colors were converted to our palette format by `scripts/import-themes.js`; only themes that declare a permissive license (MIT, Apache-2.0, CC0-1.0 and similar) and meet the readability limits below are included, and the rest are skipped. To add a theme by hand, put a valid theme JSON file in `assets/themes` and run the script, which rebuilds the index and keeps hand-made files. The author, license and source of each theme are listed in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md); if you own one and want it removed, please open an issue.

## Creating a custom theme

Use **New dark theme** or **New light theme** in the toolbar at the top of the Custom themes section, or **Duplicate** on any row. The editor starts from a copy of an existing theme. It has a name field, the Mode, and 13 Color roles: Background, Text, Muted text, Border, Accent, Red, Orange, Yellow, Green, Cyan, Blue, Purple, Pink. A live preview updates as you edit, and contrast warnings appear when text, muted text, accent or border colors are too close to the background. Custom cards can be edited, duplicated and deleted (with confirmation).

Optional roles (alternate background, inset background, comment, selection and per-token syntax colors) are derived when omitted. They can be set in an imported file. Editing a Color role in the editor re-derives the optional values that depend on it: Background or Text resets the alternate and inset backgrounds, Muted text the comment color, Accent the selection, and Pink, Green, Purple, Yellow, Cyan or Orange the keyword, function, constant, string, tag or variable syntax color.

## Import and export

**Export** downloads all Custom themes as `github-enhancer-themes.json`. **Import** reads such a file; a theme whose name matches an existing one (ignoring case) replaces it, others are added. An invalid file shows an error and changes nothing. A theme whose id is a Built-in theme's id (or already used by another Custom theme) is added with a new id.

```json
{
  "format": "gha-themes",
  "version": 1,
  "themes": [
    {
      "id": "my-dracula",
      "name": "My Dracula",
      "mode": "dark",
      "palette": {
        "bg": "#282a36",
        "bgAlt": "#21222c",
        "bgInset": "#191a21",
        "fg": "#f8f8f2",
        "fgMuted": "#b6b8c4",
        "comment": "#6272a4",
        "border": "#44475a",
        "selection": "#44475a",
        "accent": "#8be9fd",
        "red": "#ff5555",
        "orange": "#ffb86c",
        "yellow": "#f1fa8c",
        "green": "#50fa7b",
        "cyan": "#8be9fd",
        "blue": "#bd93f9",
        "purple": "#bd93f9",
        "pink": "#ff79c6",
        "syntax": {
          "keyword": "#ff79c6",
          "function": "#50fa7b",
          "constant": "#bd93f9",
          "string": "#f1fa8c",
          "tag": "#ff79c6",
          "variable": "#ffb86c"
        }
      }
    }
  ]
}
```

## Limits

- At most 200 Custom themes in total; saving or importing past that fails with an error and changes nothing.
- At most 200 themes per imported file.
- Names are 1 to 60 characters.
- Ids are lowercase letters, digits and hyphens, up to 64 characters.
- Colors must be `#rgb`, `#rrggbb` or `#rrggbbaa`.
- Import files larger than 1 MB are rejected.

## Known limitations

- Some GitHub surfaces may use hardcoded colors instead of Primer variables and keep GitHub's colors.
- A one-frame flash of GitHub's default colors is possible on page load.
- A Custom Active theme is applied only after custom themes are read from storage, so it appears slightly later than a Built-in one.
- Monokai Pro is not included because its palette is proprietary; the Built-in Monokai is the classic palette.

## Palette credits and removal requests

The built-in themes use color values from well-known editor themes. The sources, licenses and copyright lines are listed in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). If you own one of these palettes and do not want your theme to be here, please [reach out](https://github.com/nerdtronik/github-enhancer/issues) and we will remove it. We do not want to conflict with the owners.

