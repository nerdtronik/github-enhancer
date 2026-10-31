/**
 * The built-in themes are JSON files shipped in dist/themes (see catalog.ts). This module only
 * tracks their ids once the index is read, so a custom theme cannot take one of those ids, and
 * looks themes up in a list.
 */
import type { Theme } from "./theme";

const fileThemeIds = new Set<string>();

export function registerBuiltinIds(ids: Iterable<string>): void {
  for (const id of ids) fileThemeIds.add(id);
}

/** Every built-in id read so far. */
export const builtinIds = (): string[] => [...fileThemeIds];

export function isBuiltin(id: string): boolean {
  return fileThemeIds.has(id);
}

/** The first theme of `themes` with this id; null or an unknown id returns undefined. */
export function findTheme(id: string | null, themes: readonly Theme[]): Theme | undefined {
  if (id === null) return undefined;
  return themes.find((theme) => theme.id === id);
}
