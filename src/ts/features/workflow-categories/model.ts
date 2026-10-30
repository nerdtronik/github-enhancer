/** Pure category data model: V1 conversion, validation, backup merge and equality.
 * No DOM or storage. */

export interface Category {
  name: string;
  workflows: string[];
  collapsed: boolean;
}

export type Snapshot = { categories: Category[] };

export const cloneCategories = (categories: Category[]): Category[] =>
  categories.map(({ name, workflows, collapsed }) => ({
    name,
    workflows: [...workflows],
    collapsed,
  }));

/**
 * Converts the V1 shape (name list, a workflow-id -> names map, and a collapsed-names list) into
 * V2 categories. Lenient on purpose: stored data is trusted to be roughly shaped, so invalid or
 * duplicate names are dropped instead of throwing. Strict checks live in validateBackup.
 */
export function fromLegacy(value: unknown): Snapshot {
  const stored = value as
    | { categories?: unknown[]; assignments?: Record<string, unknown>; collapsed?: unknown[] }
    | undefined;
  const names = Array.isArray(stored?.categories)
    ? [
        ...new Set(
          stored.categories.filter(
            (name): name is string =>
              typeof name === "string" &&
              name.trim() === name &&
              name.length > 0,
          ),
        ),
      ]
    : [];
  const assignments = Object.entries(stored?.assignments ?? {});
  return {
    categories: names.map((name) => ({
      name,
      workflows: assignments
        .filter(
          ([id, values]) =>
            id && Array.isArray(values) && values.includes(name),
        )
        .map(([id]) => id),
      collapsed:
        Array.isArray(stored?.collapsed) && stored.collapsed.includes(name),
    })),
  };
}

/**
 * Strict check of V2 data (imports and stored records): throws a generic Error if any name or
 * workflow list is malformed. Names must be unique case-insensitively.
 */
export function validateCategories(value: unknown): Category[] {
  const categories = value as Category[];
  if (
    !Array.isArray(categories) ||
    categories.some(
      (category) =>
        !category ||
        typeof category !== "object" ||
        Array.isArray(category) ||
        typeof category.name !== "string" ||
        !category.name ||
        category.name.trim() !== category.name ||
        category.name.length > 40 ||
        !Array.isArray(category.workflows) ||
        category.workflows.some((id) => typeof id !== "string" || !id) ||
        new Set(category.workflows).size !== category.workflows.length ||
        typeof category.collapsed !== "boolean",
    ) ||
    new Set(categories.map((category) => category.name.toLowerCase())).size !==
      categories.length
  )
    throw new Error(
      "Invalid category backup: categories or workflows are inconsistent.",
    );
  return cloneCategories(categories);
}

// Strict V1 backup check; every name referenced by assignments or collapsed must be declared.
function validLegacyBackup(backup: any): boolean {
  const names = backup.categories;
  const assignments = backup.assignments;
  const hidden = backup.collapsed;
  return !(
    !Array.isArray(names) ||
    !assignments ||
    typeof assignments !== "object" ||
    Array.isArray(assignments) ||
    !Array.isArray(hidden) ||
    names.some(
      (name) =>
        typeof name !== "string" ||
        !name ||
        name.trim() !== name ||
        name.length > 40,
    ) ||
    new Set(names.map((name) => name.toLowerCase())).size !== names.length ||
    hidden.some((name) => !names.includes(name)) ||
    new Set(hidden).size !== hidden.length ||
    Object.entries(assignments).some(
      ([id, values]) =>
        !id ||
        !Array.isArray(values) ||
        values.some((name) => !names.includes(name)) ||
        new Set(values).size !== values.length,
    )
  );
}

/**
 * Validates an imported backup file (V1 or V2) and returns it as a Snapshot, or throws. The
 * repository is a parameter so backups for another repository are rejected without this module
 * knowing the current page.
 */
export function validateBackup(value: unknown, repository: string): Snapshot | null {
  const backup = value as any;
  if (
    !backup ||
    backup.format !== "gha-workflow-categories" ||
    ![1, 2].includes(backup.version) ||
    backup.repository !== repository
  )
    throw new Error(
      backup?.repository && backup.repository !== repository
        ? "This backup belongs to another repository."
        : "Invalid or unsupported category backup.",
    );
  if (backup.version === 2)
    return { categories: validateCategories(backup.categories) };
  if (!validLegacyBackup(backup))
    throw new Error(
      "Invalid category backup: categories or assignments are inconsistent.",
    );
  return fromLegacy(backup);
}

/**
 * Merge by case-insensitive name: an existing category keeps its own name and collapsed state and
 * gains the union of workflows; categories not present yet are appended as imported.
 */
export function mergeBackup(current: Category[], incoming: Category[]): Category[] {
  const merged = cloneCategories(current);
  const names = new Map(
    merged.map((category) => [category.name.toLowerCase(), category]),
  );
  for (const imported of incoming) {
    const existing = names.get(imported.name.toLowerCase());
    if (existing)
      existing.workflows = [
        ...new Set([...existing.workflows, ...imported.workflows]),
      ];
    else merged.push(imported);
  }
  return merged;
}

/**
 * Compares only name, workflows (in order) and collapsed of each category, so extra properties
 * such as the `legacy` marker added by load() do not matter. A missing side is never equal.
 */
export function sameSnapshot(
  a?: { categories?: Category[] } | null,
  b?: { categories?: Category[] } | null,
): boolean {
  if (!a || !b) return false;
  const fields = (value: { categories?: Category[] }) =>
    value.categories?.map(({ name, workflows, collapsed }) => [
      name,
      workflows,
      collapsed,
    ]);
  return JSON.stringify(fields(a)) === JSON.stringify(fields(b));
}
