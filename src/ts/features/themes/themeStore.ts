/**
 * Persists custom themes in extension storage: validated on load, verified by a read-back on save.
 */
import { store } from "../../core/settings";
import { isBuiltin } from "./builtins";
import { validateTheme, type Theme } from "./theme";

export interface StoreLike {
  read<T>(name: "themes", id?: string): Promise<T | undefined>;
  write<T>(name: "themes", id: string | undefined, value: T): Promise<void>;
}

const MAX_THEMES = 200;

function parse(entry: unknown): Theme | undefined {
  try {
    return validateTheme(entry);
  } catch {
    return undefined;
  }
}

/**
 * Invalid entries, built-in ids and duplicates are dropped and the list is capped. Storage read
 * errors propagate to the caller.
 */
export async function loadCustomThemes(area: StoreLike = store): Promise<Theme[]> {
  const record = await area.read<{ themes?: unknown }>("themes");
  if (!Array.isArray(record?.themes)) return [];
  const seen = new Set<string>();
  const themes: Theme[] = [];
  for (const entry of record.themes) {
    const theme = parse(entry);
    // A stored entry must not shadow a built-in: findTheme looks built-ins up first.
    if (!theme || isBuiltin(theme.id) || seen.has(theme.id)) continue;
    seen.add(theme.id);
    themes.push(theme);
    if (themes.length === MAX_THEMES) break;
  }
  return themes;
}

const RETRY_MS = 50;
const RETRY_HINT = "Reload the page and try again; if it keeps happening please report it.";

type ReadBack = (Theme | undefined)[] | "unreadable" | undefined;

async function readBack(area: StoreLike): Promise<ReadBack> {
  const saved = await area.read<{ themes?: unknown }>("themes");
  if (saved === undefined) return undefined;
  return Array.isArray(saved?.themes) ? saved.themes.map(parse) : "unreadable";
}

const matches = (found: ReadBack, valid: Theme[]) =>
  Array.isArray(found) && JSON.stringify(found) === JSON.stringify(valid);

function mismatch(found: Exclude<ReadBack, undefined>, valid: Theme[]): Error {
  const entries = found === "unreadable" ? [] : found;
  console.warn("Themes: read-back mismatch", {
    expected: valid.map((theme) => theme.id),
    found: found === "unreadable" ? found : entries.map((theme) => theme?.id ?? null),
  });
  const index = valid.findIndex((theme, i) => JSON.stringify(theme) !== JSON.stringify(entries[i]));
  const differing = valid[index]?.id ?? entries[valid.length]?.id ?? "none";
  return new Error(
    `Saved themes did not match what was written (expected ${valid.length} themes, found ${entries.length}: ${differing}). ${RETRY_HINT}`,
  );
}

/**
 * Validates, writes, then reads back and compares, so a failed save is reported instead of silently
 * losing a theme. Throws with a user-facing message on a mismatch.
 */
export async function saveCustomThemes(themes: Theme[], area: StoreLike = store): Promise<void> {
  if (themes.length > MAX_THEMES) throw new Error(`Too many custom themes (max ${MAX_THEMES})`);
  const valid = themes.map((theme) => validateTheme(theme));
  if (valid.some((theme) => isBuiltin(theme.id)))
    throw new Error("A custom theme cannot use a built-in theme id");
  await area.write("themes", undefined, { themes: valid });
  let found = await readBack(area);
  if (matches(found, valid)) return;
  // One short retry tolerates a read-back that may lag the write.
  await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  found = await readBack(area);
  if (matches(found, valid)) return;
  if (found === undefined)
    throw new Error(`Could not read the saved themes back from extension storage (expected ${valid.length} themes). ${RETRY_HINT}`);
  throw mismatch(found, valid);
}
