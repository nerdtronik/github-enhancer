/** Persists one repository's categories in extension storage, migrating the legacy V1 record
 * on read. */
import { store } from "../../core/settings";
import { fromLegacy, sameSnapshot, type Snapshot } from "./model";

type Area = Pick<typeof store, "read" | "write">;

/**
 * Resolves to undefined when nothing is stored. The V2 "categories" record always wins; the
 * V1 "legacyCategories" record is only used when no V2 record exists, and is returned converted
 * with `legacy: true` so the caller can re-save it under the V2 key (V1 data is never deleted).
 */
export async function load(
  repository: string,
  area: Area = store,
): Promise<(Snapshot & { legacy?: true }) | undefined> {
  const [stored, legacy] = await Promise.all([
    area.read<Snapshot>("categories", repository),
    area.read<unknown>("legacyCategories", repository),
  ]);
  if (stored !== undefined || legacy === undefined) return stored;
  return { ...fromLegacy(legacy), legacy: true };
}

/**
 * Writes, then reads back and compares: a write that resolved without actually persisting would
 * otherwise look like success and the user would lose categories on reload. Throws on mismatch.
 */
export async function save(
  repository: string,
  snapshot: Snapshot,
  area: Area = store,
): Promise<void> {
  await area.write("categories", repository, snapshot);
  const saved = await area.read<Snapshot>("categories", repository);
  if (!sameSnapshot(saved, snapshot))
    throw new Error("Saved categories did not match the requested changes");
}
