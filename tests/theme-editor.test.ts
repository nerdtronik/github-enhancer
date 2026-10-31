import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { isBuiltin } from "../src/ts/features/themes/builtins";
import { BUILTIN_THEMES } from "./shipped-themes";
import { mix } from "../src/ts/features/themes/color";
import { contrastWarnings, copyOf, openEditor, startFromCopy } from "../src/ts/features/themes/editorDialog";
import { generateVariables } from "../src/ts/features/themes/generate";
import { mountThemesSection, type ActiveIds } from "../src/ts/features/themes/themesSection";
import { createThemeActions } from "../src/ts/features/themes/themeActions";
import { exportThemes, importThemes, ROLES, validateTheme, type Theme, type ThemeMode } from "../src/ts/features/themes/theme";
import { saveCustomThemes } from "../src/ts/features/themes/themeStore";
import dracula from "./fixtures/themes/dracula.json";

const fixture = readFileSync(join(__dirname, "fixtures/appearance-single-picker.html"), "utf8");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hostile = "<img src=x onerror=alert(1)>";
const mine = (id: string, name = id, mode: ThemeMode = "dark"): Theme =>
  validateTheme({ ...clone(dracula), id, name, mode });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("contrastWarnings", () => {
  test("flags a low-contrast fgMuted only", () => {
    const theme = validateTheme({ ...clone(dracula), palette: { ...clone(dracula).palette, fgMuted: "#6272a4" } });
    const warnings = contrastWarnings(theme);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("fgMuted");
    expect(warnings[0]).toMatch(/\d\.\d:1, below 4\.5:1/);
  });

  test("every built-in meets the floors", () => {
    for (const theme of BUILTIN_THEMES) expect(contrastWarnings(theme), theme.id).toEqual([]);
  });

  test("a border equal to the background is reported by role", () => {
    const palette = { ...clone(dracula).palette, border: dracula.palette.bg };
    const theme = validateTheme({ ...clone(dracula), palette });
    expect(contrastWarnings(theme)).toEqual(["Border (border) on background is 1.0:1, below 1.1:1"]);
  });
});

const darkTemplate = BUILTIN_THEMES.find((t) => t.mode === "dark")!;
const lightTemplate = BUILTIN_THEMES.find((t) => t.mode === "light")!;

describe("startFromCopy", () => {
  test("copies the first dark built-in with a fresh id", () => {
    const copy = startFromCopy("dark", undefined, darkTemplate);
    expect(copy.mode).toBe("dark");
    expect(() => validateTheme(copy)).not.toThrow();
    expect(isBuiltin(copy.id)).toBe(false);
    expect(copy.name.endsWith(" copy")).toBe(true);
    expect(copy.palette).toEqual(darkTemplate.palette);
  });

  test("uses the active theme of the same mode, else the first built-in", () => {
    const active = mine("custom-a", "Mine");
    expect(startFromCopy("dark", active, darkTemplate).name).toBe("Mine copy");
    const light = startFromCopy("light", active, lightTemplate);
    expect(light.mode).toBe("light");
    expect(light.name).toBe(`${lightTemplate.name} copy`);
  });

  test("long names are truncated to 60 characters", () => {
    const copy = startFromCopy("dark", mine("custom-a", "x".repeat(60)), darkTemplate);
    expect(copy.name.length).toBeLessThanOrEqual(60);
    expect(copy.name.endsWith(" copy")).toBe(true);
  });
});

function editor(options: { theme?: Theme; isNew?: boolean; onSave?: (theme: Theme) => Promise<void> } = {}) {
  const saved: Theme[] = [];
  let cancelled = 0;
  const close = openEditor({
    theme: options.theme ?? mine("custom-a", "Mine"),
    isNew: options.isNew ?? false,
    onSave: options.onSave ?? (async (theme) => void saved.push(theme)),
    onCancel: () => void cancelled++,
  });
  const dialog = document.querySelector<HTMLDialogElement>("dialog[data-gha-theme-editor]")!;
  const q = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
  const row = (role: string) => q<HTMLElement>(`[data-gha-role="${role}"]`);
  const hex = (role: string) => row(role).querySelector<HTMLInputElement>('input[type="text"]')!;
  const color = (role: string) => row(role).querySelector<HTMLInputElement>('input[type="color"]')!;
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return {
    dialog, q, row, hex, color, type, saved, close,
    cancelled: () => cancelled,
    save: q<HTMLButtonElement>("[data-gha-save]"),
    preview: () => q<HTMLImageElement>("img[data-gha-preview]").getAttribute("src"),
  };
}

describe("openEditor", () => {
  test("renders a row per color role", () => {
    const e = editor();
    expect(e.dialog.querySelectorAll("[data-gha-role]")).toHaveLength(13);
    expect([...e.dialog.querySelectorAll<HTMLElement>("[data-gha-role]")].map((r) => r.dataset.ghaRole)).toEqual([...ROLES]);
    expect(e.hex("bg").value).toBe("#282a36");
    expect(e.color("bg").value).toBe("#282a36");
    expect(e.preview()).toMatch(/^data:image\/svg\+xml/);
  });

  test("invalid hex marks the row, disables Save and keeps the preview", () => {
    const e = editor();
    const before = e.preview();
    e.type(e.hex("bg"), "red");
    expect(e.row("bg").getAttribute("aria-invalid")).toBe("true");
    expect(e.save.disabled).toBe(true);
    expect(e.preview()).toBe(before);
    e.type(e.hex("bg"), "#123");
    expect(e.row("bg").hasAttribute("aria-invalid")).toBe(false);
    expect(e.save.disabled).toBe(false);
    expect(e.color("bg").value).toBe("#112233");
  });

  test("an empty name disables Save", () => {
    const e = editor();
    e.type(e.q<HTMLInputElement>('[data-gha-field="name"]'), "   ");
    expect(e.save.disabled).toBe(true);
  });

  test("color input and hex text stay in sync and update the preview", () => {
    const e = editor();
    const before = e.preview();
    e.type(e.color("accent"), "#00ff00");
    expect(e.hex("accent").value).toBe("#00ff00");
    expect(e.preview()).not.toBe(before);
  });

  test("editing Background drops the alternate and inset backgrounds derived from it", async () => {
    const e = editor({ theme: copyOf(BUILTIN_THEMES[0]) });
    e.type(e.hex("bg"), "#000000");
    e.save.click();
    await flush();
    const [saved] = e.saved;
    expect(saved.palette.bgAlt).toBeUndefined();
    expect(saved.palette.bgInset).toBeUndefined();
    expect(saved.palette.selection).toBe("#44475a");
    expect(generateVariables(saved)["--bgColor-muted"]).toBe(mix(saved.palette.fg, "#000000", 0.04));
  });

  test("editing a role drops the optional values derived from it", async () => {
    const e = editor({ theme: copyOf(BUILTIN_THEMES[0]) });
    e.type(e.color("pink"), "#ee11aa");
    e.type(e.color("fgMuted"), "#c0c0c0");
    e.type(e.hex("accent"), "#00ccff");
    e.type(e.hex("green"), "#00ff00");
    e.save.click();
    await flush();
    const [saved] = e.saved;
    expect(saved.palette.syntax?.keyword).toBeUndefined();
    expect(saved.palette.syntax?.function).toBeUndefined();
    expect(saved.palette.syntax?.string).toBe("#f1fa8c");
    expect(saved.palette.comment).toBeUndefined();
    expect(saved.palette.selection).toBeUndefined();
    expect(saved.palette.bgAlt).toBe("#21222c");
    expect(BUILTIN_THEMES[0].palette.syntax?.keyword).toBe("#ff79c6");
    const vars = generateVariables(saved);
    expect(vars["--prettylights-syntax-keyword"]).toBe("#ee11aa");
    expect(vars["--prettylights-syntax-comment"]).toBe("#c0c0c0");
  });

  test("valid Save calls onSave once with a valid theme and closes", async () => {
    const e = editor();
    e.type(e.hex("bg"), "#101010");
    e.save.click();
    await flush();
    expect(e.saved).toHaveLength(1);
    expect(() => validateTheme(e.saved[0])).not.toThrow();
    expect(e.saved[0].id).toBe("custom-a");
    expect(e.saved[0].palette.bg).toBe("#101010");
    expect(e.dialog.isConnected).toBe(false);
  });

  test("a rejected onSave keeps the dialog open with the error and the values", async () => {
    const e = editor({ onSave: async () => Promise.reject(new Error("Storage is full")) });
    const name = e.q<HTMLInputElement>('[data-gha-field="name"]');
    e.type(name, "Renamed");
    e.type(e.hex("fg"), "#eeeeee");
    e.save.click();
    await flush();
    expect(e.dialog.isConnected).toBe(true);
    expect(e.dialog.open).toBe(true);
    expect(e.q("[data-gha-error]").textContent).toBe("Storage is full");
    expect(name.value).toBe("Renamed");
    expect(e.hex("fg").value).toBe("#eeeeee");
  });

  test("Cancel and Escape call onCancel and close", () => {
    const a = editor();
    a.q<HTMLButtonElement>("[data-gha-cancel]").click();
    expect(a.cancelled()).toBe(1);
    expect(a.dialog.isConnected).toBe(false);
    const b = editor();
    b.dialog.dispatchEvent(new Event("cancel"));
    expect(b.cancelled()).toBe(1);
    expect(b.dialog.isConnected).toBe(false);
  });

  test("closing without a cancel event dismisses once", async () => {
    const e = editor();
    e.dialog.close();
    await flush();
    expect(e.cancelled()).toBe(1);
    expect(e.dialog.isConnected).toBe(false);
  });

  test("a successful save never counts as a cancel", async () => {
    const e = editor();
    e.save.click();
    await flush();
    expect(e.saved).toHaveLength(1);
    expect(e.cancelled()).toBe(0);
  });

  test("Mode select exists only for new themes", async () => {
    const existing = editor();
    expect(existing.dialog.querySelector("select")).toBeNull();
    expect(existing.q('[data-gha-field="mode"]').textContent).toContain("dark");
    existing.close();
    const fresh = editor({ isNew: true });
    const select = fresh.q<HTMLSelectElement>('select[data-gha-field="mode"]');
    select.value = "light";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    fresh.save.click();
    await flush();
    expect(fresh.saved[0].mode).toBe("light");
    expect(fresh.saved[0].palette.bg).toBe("#282a36");
  });

  test("warnings list follows the draft", () => {
    const e = editor();
    const list = e.q("[data-gha-warnings]");
    expect(list.getAttribute("role")).toBe("status");
    expect(list.children).toHaveLength(0);
    e.type(e.hex("fgMuted"), "#6272a4");
    expect(list.children).toHaveLength(1);
    expect(list.textContent).toContain("fgMuted");
  });

  test("hostile name stays literal text", () => {
    const e = editor({ theme: mine("custom-a", hostile) });
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(e.q("h2").textContent).toContain(hostile);
    expect(e.q<HTMLInputElement>('[data-gha-field="name"]').value).toBe(hostile);
  });
});

function harness(initial: Theme[] = [], active: ActiveIds = { light: null, dark: null }) {
  const state = { custom: initial, active: { ...active } };
  const log: string[] = [];
  const saves: Theme[][] = [];
  const notices: [string, string][] = [];
  const downloads: [string, string][] = [];
  let editorOptions: Parameters<typeof openEditor>[0] | undefined;
  let accept = true;
  let file: string | undefined;
  const actions = createThemeActions({
    getCustom: () => state.custom,
    save: async (themes) => {
      saves.push(themes);
      state.custom = themes;
    },
    getActive: () => state.active,
    loadCatalogTheme: async (id) => BUILTIN_THEMES.find((theme) => theme.id === id),
    setActive: (mode, id) => {
      log.push(`setActive:${mode}:${id}`);
      state.active = { ...state.active, [mode]: id };
    },
    confirm: () => accept,
    openEditor: (options) => {
      editorOptions = options;
      return () => {};
    },
    download: (name, text) => void downloads.push([name, text]),
    readFile: async () => file,
    notify: (message, kind) => void notices.push([message, kind]),
  });
  return {
    actions, state, log, saves, notices, downloads,
    editor: () => editorOptions,
    decline: () => void (accept = false),
    file: (text: string | undefined) => void (file = text),
  };
}

describe("theme actions", () => {
  test("create opens a new copy and saving appends it", async () => {
    const h = harness([mine("custom-a")]);
    await h.actions.create("light");
    const options = h.editor()!;
    expect(options.isNew).toBe(true);
    expect(options.theme.mode).toBe("light");
    await options.onSave(options.theme);
    expect(h.state.custom.map((t) => t.id)).toEqual(["custom-a", options.theme.id]);
  });

  test("create starts from the active theme of that mode", async () => {
    const h = harness([mine("custom-a", "Mine")], { light: null, dark: "custom-a" });
    await h.actions.create("dark");
    expect(h.editor()!.theme.name).toBe("Mine copy");
  });

  test("edit replaces by id", async () => {
    const h = harness([mine("custom-a"), mine("custom-b")]);
    h.actions.edit("custom-b");
    const options = h.editor()!;
    expect(options.isNew).toBe(false);
    await options.onSave({ ...options.theme, name: "Changed" });
    expect(h.state.custom.map((t) => [t.id, t.name])).toEqual([["custom-a", "custom-a"], ["custom-b", "Changed"]]);
  });

  test("edit of a built-in or unknown id does nothing", () => {
    const h = harness([mine("custom-a")]);
    h.actions.edit("dracula");
    h.actions.edit("nope");
    expect(h.editor()).toBeUndefined();
  });

  test("duplicate of a built-in saves a custom copy and selects nothing", async () => {
    const h = harness();
    await h.actions.duplicate("dracula");
    expect(h.saves).toHaveLength(1);
    const [copy] = h.state.custom;
    expect(copy.name).toBe("Dracula copy");
    expect(isBuiltin(copy.id)).toBe(false);
    expect(copy.palette).toEqual(BUILTIN_THEMES[0].palette);
    expect(h.log).toEqual([]);
  });

  test("remove asks first; declining saves nothing", async () => {
    const h = harness([mine("custom-a")], { light: null, dark: "custom-a" });
    h.decline();
    await h.actions.remove("custom-a");
    expect(h.saves).toEqual([]);
    expect(h.log).toEqual([]);
  });

  test("remove of the active theme clears that mode", async () => {
    const h = harness([mine("custom-a"), mine("custom-b")], { light: null, dark: "custom-a" });
    await h.actions.remove("custom-a");
    expect(h.state.custom.map((t) => t.id)).toEqual(["custom-b"]);
    expect(h.log).toEqual(["setActive:dark:null"]);
  });

  test("remove of an inactive theme keeps the active ids", async () => {
    const h = harness([mine("custom-a"), mine("custom-b")], { light: null, dark: "custom-b" });
    await h.actions.remove("custom-a");
    expect(h.saves).toHaveLength(1);
    expect(h.log).toEqual([]);
  });

  test("remove of a built-in does nothing", async () => {
    const h = harness();
    await h.actions.remove("dracula");
    expect(h.saves).toEqual([]);
  });

  test("exportAll downloads text importThemes accepts", () => {
    const h = harness([mine("custom-a"), mine("custom-b")]);
    h.actions.exportAll();
    const [[name, text]] = h.downloads;
    expect(name).toBe("github-enhancer-themes.json");
    expect(importThemes(text, []).added).toBe(2);
    expect(h.notices[0][1]).toBe("info");
    expect(h.notices[0][0]).toContain("2");
  });

  test("exportAll with nothing to export reports an error", () => {
    const h = harness();
    h.actions.exportAll();
    expect(h.downloads).toEqual([]);
    expect(h.notices[0][1]).toBe("error");
  });

  test("importFile saves the merge and reports counts", async () => {
    const h = harness([mine("custom-a", "Same")]);
    h.file(exportThemes([mine("custom-x", "Same"), mine("custom-y", "New")]));
    await h.actions.importFile();
    expect(h.state.custom.map((t) => t.name)).toEqual(["Same", "New"]);
    expect(h.notices).toEqual([["Imported 1, replaced 1", "info"]]);
  });

  test("importFile of garbage notifies and saves nothing", async () => {
    const h = harness([mine("custom-a")]);
    h.file(`${"x".repeat(500)}`);
    await h.actions.importFile();
    expect(h.saves).toEqual([]);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0][1]).toBe("error");
    expect(h.notices[0][0].length).toBeLessThanOrEqual(120);
  });

  test("importFile cancelled does nothing", async () => {
    const h = harness([mine("custom-a")]);
    h.file(undefined);
    await h.actions.importFile();
    expect(h.saves).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  test("quick repeated actions each see the previous save", async () => {
    const state = { custom: [] as Theme[] };
    const saves: Theme[][] = [];
    const actions = createThemeActions({
      getCustom: () => state.custom,
      save: async (themes) => {
        saves.push(themes);
        await flush();
        state.custom = themes;
      },
      getActive: () => ({ light: null, dark: null }),
      loadCatalogTheme: async (id) => BUILTIN_THEMES.find((theme) => theme.id === id),
      setActive: () => {},
      confirm: () => true,
      openEditor: () => () => {},
      download: () => {},
      readFile: async () => undefined,
      notify: () => {},
    });
    await Promise.all([actions.duplicate("dracula"), actions.duplicate("nord")]);
    expect(saves).toHaveLength(2);
    expect(saves[1].map((t) => t.name)).toEqual(["Dracula copy", "Nord copy"]);
  });

  test("a failed save is reported and changes nothing", async () => {
    const h = harness([mine("custom-a")], { light: null, dark: "custom-a" });
    const actions = createThemeActions({
      ...{
        getCustom: () => h.state.custom,
        getActive: () => h.state.active,
        loadCatalogTheme: async (id: string) => BUILTIN_THEMES.find((theme) => theme.id === id),
        setActive: () => void h.log.push("setActive"),
        confirm: () => true,
        openEditor: () => () => {},
        download: () => {},
        readFile: async () => undefined,
        notify: (message, kind) => void h.notices.push([message, kind]),
      },
      save: async () => Promise.reject(new Error("quota")),
    });
    await actions.remove("custom-a");
    await actions.duplicate("dracula");
    expect(h.log).toEqual([]);
    expect(h.notices).toEqual([["quota", "error"], ["quota", "error"]]);
  });

  test("importing a file with a built-in id adds it under a fresh custom id that saves", async () => {
    const text = exportThemes([validateTheme(clone(dracula))]);
    const result = importThemes(text, [], BUILTIN_THEMES.map((t) => t.id));
    expect(result.added).toBe(1);
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0].id).toMatch(/^custom-[a-z0-9]+$/);
    let stored: unknown;
    const area = { read: async () => stored, write: async (_n: string, _i: unknown, value: unknown) => void (stored = value) } as any;
    await expect(saveCustomThemes(result.themes, area)).resolves.toBeUndefined();
  });

  test("importFile never keeps a built-in id from the file", async () => {
    const h = harness();
    h.file(exportThemes([validateTheme(clone(dracula))]));
    await h.actions.importFile();
    expect(h.state.custom).toHaveLength(1);
    expect(isBuiltin(h.state.custom[0].id)).toBe(false);
    expect(h.notices).toEqual([["Imported 1, replaced 0", "info"]]);
  });

  test("saveCustomThemes rejects built-in ids", async () => {
    const area = { read: async () => undefined, write: async () => {} } as any;
    await expect(saveCustomThemes([mine("dracula")], area)).rejects.toThrow(/built-in/);
  });
});

describe("card actions and toolbar", () => {
  const calls: string[] = [];
  const handlers = {
    select: (mode: ThemeMode, id: string) => void calls.push(`select:${mode}:${id}`),
    clear: (mode: ThemeMode) => void calls.push(`clear:${mode}`),
    actions: {
      duplicate: (id: string) => void calls.push(`duplicate:${id}`),
      edit: (id: string) => void calls.push(`edit:${id}`),
      remove: (id: string) => void calls.push(`remove:${id}`),
    },
    toolbar: {
      create: (mode: ThemeMode) => void calls.push(`create:${mode}`),
      importFile: () => void calls.push("import"),
      exportAll: () => void calls.push("export"),
    },
  };
  const none = { light: null, dark: null };
  const themes = [...BUILTIN_THEMES, mine("custom-a", hostile)];
  const buttons = (id: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(`[data-gha-theme="${id}"] button`)];

  beforeEach(() => {
    calls.length = 0;
    document.body.innerHTML = `<appearance-form><form>${fixture}</form></appearance-form>`;
  });

  test("built-in cards only duplicate; custom cards edit, duplicate and delete", () => {
    mountThemesSection(document, themes, none, handlers);
    expect(buttons("dracula").map((b) => b.textContent)).toEqual(["Duplicate"]);
    expect(buttons("custom-a").map((b) => b.dataset.ghaAction)).toEqual(["edit", "duplicate", "delete"]);
    expect(buttons("custom-a").map((b) => b.textContent)).toEqual(["Edit", "Duplicate", "Delete"]);
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-gha-action]")) {
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("form")).toBe("gha-themes-detached");
    }
  });

  test("hostile name is literal text in the card", () => {
    mountThemesSection(document, themes, none, handlers);
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(document.querySelector('[data-gha-theme="custom-a"] .gha-theme-name')!.textContent).toBe(hostile);
  });

  test("clicking an action calls it once without touching the radio or the document", () => {
    mountThemesSection(document, themes, none, handlers);
    const seen: string[] = [];
    document.addEventListener("click", (e) => void seen.push(e.type));
    const radio = document.querySelector<HTMLInputElement>('[data-gha-theme="custom-a"] input[type="radio"]')!;
    const builtin = document.querySelector<HTMLInputElement>('[data-gha-theme="dracula"] input[type="radio"]')!;
    for (const button of buttons("custom-a")) button.click();
    buttons("dracula")[0].click();
    expect(calls).toEqual(["edit:custom-a", "duplicate:custom-a", "remove:custom-a", "duplicate:dracula"]);
    expect(radio.checked).toBe(false);
    expect(builtin.checked).toBe(false);
    expect(seen).toEqual([]);
  });

  test("action buttons are the last element of the row, after the label", () => {
    mountThemesSection(document, themes, none, handlers);
    for (const id of ["dracula", "custom-a"]) {
      const row = document.querySelector(`[data-gha-theme="${id}"]`)!;
      const bar = row.lastElementChild as HTMLElement;
      expect(bar.hasAttribute("data-gha-theme-actions")).toBe(true);
      expect(bar.previousElementSibling).toBe(row.querySelector(":scope > .Label"));
      expect(row.querySelector(":scope > label.gha-theme-label .Label")).toBeNull();
      expect(bar.querySelectorAll("[data-gha-action]")).toHaveLength(buttons(id).length);
    }
  });

  test("edited theme content re-renders its card", () => {
    mountThemesSection(document, [...themes, mine("custom-b")], none, handlers);
    mountThemesSection(document, [...BUILTIN_THEMES, mine("custom-a", "Renamed"), mine("custom-b")], none, handlers);
    expect(document.querySelectorAll('[data-gha-theme="custom-a"]')).toHaveLength(1);
    const dark = document.querySelector('[data-gha-themes-mode="dark"] [role="radiogroup"]')!;
    const ids = [...dark.querySelectorAll<HTMLElement>("[data-gha-theme]")].map((c) => c.dataset.ghaTheme);
    expect(ids.slice(-2)).toEqual(["custom-a", "custom-b"]);
    expect(document.querySelector('[data-gha-theme="custom-a"] .gha-theme-name')!.textContent).toBe("Renamed");
  });

  test("toolbar sits once in the section before the sub-sections and dispose removes it", () => {
    mountThemesSection(document, themes, none, handlers);
    const dispose = mountThemesSection(document, themes, none, handlers);
    const toolbars = document.querySelectorAll("[data-gha-themes-toolbar]");
    expect(toolbars).toHaveLength(1);
    expect(toolbars[0].parentElement!.hasAttribute("data-gha-themes-section")).toBe(true);
    expect(toolbars[0].nextElementSibling).toBe(document.querySelector('[data-gha-themes-mode="dark"]'));
    const labels = [...toolbars[0].querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["New dark theme", "New light theme", "Import", "Export"]);
    for (const button of toolbars[0].querySelectorAll("button")) {
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("form")).toBe("gha-themes-detached");
    }
    expect(toolbars[0].querySelector('[role="status"]')).not.toBeNull();
    expect(toolbars[0].querySelector("p, [data-gha-themes-note]")).toBeNull();
    dispose();
    expect(document.querySelector("[data-gha-themes-toolbar]")).toBeNull();
  });

  test("toolbar buttons call their actions", () => {
    mountThemesSection(document, themes, none, handlers);
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-gha-themes-toolbar] button")) button.click();
    expect(calls).toEqual(["create:dark", "create:light", "import", "export"]);
  });

  test("no toolbar without toolbar handlers", () => {
    mountThemesSection(document, themes, none, { select: handlers.select, clear: handlers.clear });
    expect(document.querySelector("[data-gha-themes-toolbar]")).toBeNull();
    expect(document.querySelector("[data-gha-action]")).toBeNull();
  });
});
