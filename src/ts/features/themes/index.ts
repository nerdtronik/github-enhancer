/**
 * Content script entry at document_start: wires settings and storage to the theme controller and
 * the Appearance page UI.
 */
import { createPageScheduler } from "../../core/scheduler";
import { settings, store } from "../../core/settings";
import { BUILTIN_THEMES } from "./builtins";
import { createAppearanceMount, isAppearancePage, shouldRemount, startAndMount } from "./appearancePage";
import { openEditor } from "./editorDialog";
import { createThemeController } from "./injector";
import { createThemeActions, downloadText, readJsonFile } from "./themeActions";
import { loadCustomThemes, saveCustomThemes } from "./themeStore";
import { showNotice } from "./toolbar";
import type { ThemeMode } from "./theme";

const readIds = () => ({
  light: settings.get("appearance_lightTheme"),
  dark: settings.get("appearance_darkTheme"),
});

// Settings and the storage area are injected so the controller stays testable without extension
// APIs.
const controller = createThemeController({
  doc: document,
  ready: settings.ready,
  readIds,
  loadCustom: () => loadCustomThemes(),
  watchCustom: (listener) => void store.watch("themes", undefined, listener),
  onIdsChange: (listener) =>
    void settings.onChange((key) => {
      if (key === "appearance_lightTheme" || key === "appearance_darkTheme") listener();
    }),
});

const pickerKey = (mode: ThemeMode) => (mode === "light" ? "appearance_lightTheme" : "appearance_darkTheme");

const setActive = (mode: ThemeMode, id: string | null) =>
  void settings.set(pickerKey(mode), id).catch((error) => console.warn("Could not save the active theme", error));

const actions = createThemeActions({
  getCustom: controller.getCustom,
  save: async (themes) => {
    await saveCustomThemes(themes);
    // Re-read storage so the stylesheet and the cards show what was actually saved.
    await controller.reload();
    appearance.mount();
  },
  getActive: readIds,
  setActive,
  confirm: (message) => window.confirm(message),
  openEditor,
  download: downloadText,
  readFile: readJsonFile,
  notify: showNotice,
});

const appearance = createAppearanceMount({
  getThemes: () => [...BUILTIN_THEMES, ...controller.getCustom()],
  getActive: readIds,
  handlers: {
    select: setActive,
    clear: (mode) => setActive(mode, null),
    actions: {
      duplicate: (id) => void actions.duplicate(id),
      edit: actions.edit,
      remove: (id) => void actions.remove(id),
    },
    toolbar: {
      create: actions.create,
      importFile: () => void actions.importFile(),
      exportAll: actions.exportAll,
    },
  },
});

const scheduler = createPageScheduler({
  update: appearance.mount,
  active: isAppearancePage,
  observe: { childList: true, subtree: true },
  relevant: shouldRemount,
  events: ["turbo:load", "popstate"],
});

// Custom themes changed (possibly from another tab): refresh the cards.
controller.onCustomChange(() => scheduler.schedule());
settings.onChange((key) => {
  if (key === "appearance_lightTheme" || key === "appearance_darkTheme") scheduler.schedule();
});

void controller
  .start()
  .catch((error) => console.warn("Themes: could not read settings or custom themes", error))
  // Runs even when reading settings failed, so the page UI still mounts.
  .then(() => startAndMount(scheduler));
