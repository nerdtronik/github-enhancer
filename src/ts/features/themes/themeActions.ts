/**
 * User actions on custom themes (create, edit, duplicate, delete, import, export), with storage and
 * UI injected.
 */
import { BUILTIN_THEMES, findTheme } from "./builtins";
import { copyOf, errorText, startFromCopy, type openEditor } from "./editorDialog";
import type { ActiveIds } from "./themesSection";
import { exportThemes, importThemes, type Theme, type ThemeMode } from "./theme";
import { DETACHED_FORM } from "./toolbar";

export interface ThemeActionDeps {
  getCustom(): Theme[];
  save(themes: Theme[]): Promise<void>;
  getActive(): ActiveIds;
  setActive(mode: ThemeMode, id: string | null): void;
  confirm(message: string): boolean;
  openEditor: typeof openEditor;
  download(filename: string, text: string): void;
  readFile(): Promise<string | undefined>;
  notify(message: string, kind: "info" | "error"): void;
}

export const EXPORT_FILENAME = "github-enhancer-themes.json";
// Checked before the file is read into memory.
const MAX_FILE_BYTES = 1_000_000;

export function createThemeActions(deps: ThemeActionDeps) {
  let closeEditor: (() => void) | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  // Saves run one at a time, and each rebuilds the list from getCustom() only when it starts, so
  // rapid actions cannot overwrite each other. A failed task does not block the queue.
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };
  const findCustom = (id: string) => deps.getCustom().find((theme) => theme.id === id);

  const edit = (theme: Theme, isNew: boolean, apply: (theme: Theme) => Theme[]) => {
    // Only one editor dialog is open at a time.
    closeEditor?.();
    closeEditor = deps.openEditor({
      theme,
      isNew,
      onSave: (saved) => serial(() => deps.save(apply(saved))),
      onCancel: () => {},
    });
  };

  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      deps.notify(errorText(error), "error");
    }
  };

  return {
    create(mode: ThemeMode) {
      const active = findTheme(deps.getActive()[mode], deps.getCustom());
      edit(startFromCopy(mode, active), true, (theme) => [...deps.getCustom(), theme]);
    },
    edit(id: string) {
      const theme = findCustom(id);
      if (!theme) return;
      edit(theme, false, (saved) => deps.getCustom().map((t) => (t.id === saved.id ? saved : t)));
    },
    duplicate: (id: string) =>
      attempt(() => serial(async () => {
        const source = findTheme(id, deps.getCustom());
        if (!source) return;
        const copy = copyOf(source);
        await deps.save([...deps.getCustom(), copy]);
        deps.notify(`Created ${copy.name}`, "info");
      })),
    remove: (id: string) =>
      attempt(() => serial(async () => {
        const theme = findCustom(id);
        if (!theme || !deps.confirm(`Delete the theme "${theme.name}"?`)) return;
        await deps.save(deps.getCustom().filter((t) => t.id !== id));
        // A deleted theme must not stay Active.
        if (deps.getActive()[theme.mode] === id) deps.setActive(theme.mode, null);
      })),
    exportAll() {
      const themes = deps.getCustom();
      if (!themes.length) return deps.notify("There are no custom themes to export", "error");
      deps.download(EXPORT_FILENAME, exportThemes(themes));
      deps.notify(`Exported ${themes.length} ${themes.length === 1 ? "theme" : "themes"}`, "info");
    },
    importFile: () =>
      attempt(async () => {
        // The file dialog can stay open for long, so only the save is serialized.
        const text = await deps.readFile();
        if (text === undefined) return;
        await serial(async () => {
          const result = importThemes(text, deps.getCustom(), BUILTIN_THEMES.map((theme) => theme.id));
          await deps.save(result.themes);
          deps.notify(`Imported ${result.added}, replaced ${result.replaced}`, "info");
        });
      }),
  };
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // The download was requested by click(); release the URL on the next task.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readJsonFile(): Promise<string | undefined> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.setAttribute("form", DETACHED_FORM);
  return new Promise((resolve, reject) => {
    input.addEventListener("cancel", () => resolve(undefined));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      if (file.size > MAX_FILE_BYTES) return reject(new Error("Invalid file: larger than 1 MB"));
      file.text().then(resolve, reject);
    });
    input.click();
  });
}
