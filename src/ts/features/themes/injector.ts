/**
 * Applies the Active themes as one <style id="gha-themes"> and keeps it attached across Turbo
 * navigations.
 */
import { findTheme } from "./builtins";
import { generateStylesheet } from "./generate";
import type { Theme, ThemeMode } from "./theme";

export interface ActiveThemes {
  light?: Theme;
  dark?: Theme;
}

const STYLE_ID = "gha-themes";

// A theme only fills the slot of its own Mode; an id of the other Mode or of a deleted theme yields
// nothing, so GitHub's colors apply.
function resolveSlot(id: string | null, custom: readonly Theme[], mode: ThemeMode): Theme | undefined {
  const theme = findTheme(id, custom);
  return theme?.mode === mode ? theme : undefined;
}

/** Resolves the Active theme ids (null means GitHub default) to themes, one slot per Mode. */
export function resolveActive(
  lightId: string | null,
  darkId: string | null,
  custom: readonly Theme[],
): ActiveThemes {
  const active: ActiveThemes = {};
  const light = resolveSlot(lightId, custom, "light");
  const dark = resolveSlot(darkId, custom, "dark");
  if (light) active.light = light;
  if (dark) active.dark = dark;
  return active;
}

/**
 * Owns <style id="gha-themes">: apply() regenerates it, ensure() re-attaches it, dispose() removes
 * it.
 */
export function createInjector(doc: Document) {
  let style: HTMLStyleElement | undefined;
  let css = "";

  const remove = () => {
    style?.remove();
    style = undefined;
  };

  const ensure = () => {
    // Nothing to attach to yet; the next render or turbo:load retries.
    if (!doc.documentElement) return;
    // No Active theme: leave no element behind so GitHub's own colors apply.
    if (!css) return remove();
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
    }
    // Identical rewrites are skipped: they would still notify observers of the style (see
    // themeWatch).
    if (style.textContent !== css) style.textContent = css;
    // A direct child of <html>: it needs no <head>, which may not exist at document_start, and it
    // comes after GitHub's own stylesheets in document order. We also rely on it surviving head
    // swaps; turbo:load re-attaches it if GitHub removed it.
    if (style.parentNode !== doc.documentElement) doc.documentElement.appendChild(style);
  };

  return {
    apply(active: ActiveThemes): void {
      css = generateStylesheet(active);
      ensure();
    },
    ensure,
    dispose(): void {
      css = "";
      remove();
    },
  };
}

export interface ThemeControllerDeps {
  doc: Document;
  ready: Promise<unknown>;
  readIds(): { light: string | null; dark: string | null };
  loadCustom(): Promise<Theme[]>;
  watchCustom(listener: () => void): void;
  onIdsChange(listener: () => void): void;
}

/**
 * Renders in two stages: first the built-in themes as soon as settings are ready, then again once
 * custom themes are read from storage. Built-ins therefore paint without waiting for storage.
 */
export function createThemeController(deps: ThemeControllerDeps) {
  const injector = createInjector(deps.doc);
  let custom: Theme[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();

  const render = () => {
    const { light, dark } = deps.readIds();
    injector.apply(resolveActive(light, dark, custom));
  };

  const reloadCustom = async () => {
    // Each reload takes a ticket; if a newer reload started while this one awaited storage, this
    // result is dropped.
    const current = ++sequence;
    try {
      const loaded = await deps.loadCustom();
      if (current !== sequence) return;
      custom = loaded;
      render();
      for (const listener of listeners) listener();
    } catch (error) {
      // Keep the previously loaded custom themes and what is already rendered.
      console.warn("[gha] themes: could not load custom themes", error);
    }
  };

  const start = async () => {
    deps.onIdsChange(render);
    deps.watchCustom(() => void reloadCustom());
    // Navigation may have dropped the style element; put it back.
    deps.doc.addEventListener("turbo:load", () => injector.ensure());
    try {
      await deps.ready;
    } catch (error) {
      // Without settings the Active themes are unknown, so GitHub's colors are left untouched.
      console.warn("[gha] themes: settings unavailable", error);
      return;
    }
    // Stage 1: built-ins only (custom is still empty). Stage 2 follows below.
    render();
    await reloadCustom();
  };

  return {
    start,
    render,
    reload: reloadCustom,
    getCustom: (): Theme[] => custom,
    onCustomChange(listener: () => void): void {
      listeners.add(listener);
    },
  };
}
