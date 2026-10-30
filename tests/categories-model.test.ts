import { expect, test } from "@rstest/core";
import {
  fromLegacy,
  mergeBackup,
  sameSnapshot,
  validateBackup,
  validateCategories,
} from "../src/ts/features/workflow-categories/model";
import { load, save } from "../src/ts/features/workflow-categories/categoryStore";

const REPO = "owner/repo";
const category = (name: string, workflows: string[] = [], collapsed = false) => ({
  name,
  workflows,
  collapsed,
});

function memoryStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    async read(name: string, id?: string) {
      return structuredClone(data[`${name}:${id}`]);
    },
    async write(name: string, id: string | undefined, value: unknown) {
      data[`${name}:${id}`] = structuredClone(value);
    },
  } as any;
}

test("fromLegacy converts names, assignments and collapsed flags", () => {
  expect(
    fromLegacy({
      categories: ["Build", "Deploy"],
      assignments: { "build.yml": ["Build"], "deploy.yml": ["Build", "Deploy"] },
      collapsed: ["Deploy"],
    }),
  ).toEqual({
    categories: [
      category("Build", ["build.yml", "deploy.yml"]),
      category("Deploy", ["deploy.yml"], true),
    ],
  });
});

test("fromLegacy drops invalid names and duplicates", () => {
  expect(fromLegacy({ categories: ["A", "", " B", 3, "A"] })).toEqual({
    categories: [category("A")],
  });
  expect(fromLegacy(undefined)).toEqual({ categories: [] });
});

test("validateCategories returns detached copies", () => {
  const input = [category("Build", ["build.yml"])];
  const result = validateCategories(input);
  expect(result).toEqual(input);
  expect(result[0]).not.toBe(input[0]);
  expect(result[0].workflows).not.toBe(input[0].workflows);
});

test("validateCategories rejects entries without a name", () => {
  expect(() => validateCategories([{ workflows: [], collapsed: false }])).toThrow(
    "Invalid category backup: categories or workflows are inconsistent.",
  );
  expect(() => validateCategories([category("")])).toThrow();
});

test("validateCategories rejects inconsistent categories", () => {
  expect(() => validateCategories("nope")).toThrow();
  expect(() => validateCategories([category("A"), category("a")])).toThrow();
  expect(() => validateCategories([category("A", ["x", "x"])])).toThrow();
  expect(() => validateCategories([category(" A")])).toThrow();
  expect(() => validateCategories([category("A".repeat(41))])).toThrow();
  expect(() => validateCategories([{ name: "A", workflows: [] }])).toThrow();
  expect(validateCategories([])).toEqual([]);
});

test("validateBackup accepts version 2 backups for the repository", () => {
  const backup = {
    format: "gha-workflow-categories",
    version: 2,
    repository: REPO,
    categories: [category("Build", ["build.yml"], true)],
  };
  expect(validateBackup(backup, REPO)).toEqual({ categories: backup.categories });
});

test("validateBackup converts version 1 backups", () => {
  const backup = {
    format: "gha-workflow-categories",
    version: 1,
    repository: REPO,
    categories: ["Build"],
    assignments: { "build.yml": ["Build"] },
    collapsed: [],
  };
  expect(validateBackup(backup, REPO)).toEqual({
    categories: [category("Build", ["build.yml"])],
  });
});

test("validateBackup rejects other repositories and unknown formats", () => {
  const backup = { format: "gha-workflow-categories", version: 2, repository: "other/repo", categories: [] };
  expect(() => validateBackup(backup, REPO)).toThrow("This backup belongs to another repository.");
  expect(() => validateBackup({ ...backup, repository: REPO, version: 3 }, REPO)).toThrow(
    "Invalid or unsupported category backup.",
  );
  expect(() => validateBackup(null, REPO)).toThrow("Invalid or unsupported category backup.");
});

test("validateBackup rejects inconsistent version 1 assignments", () => {
  expect(() =>
    validateBackup(
      {
        format: "gha-workflow-categories",
        version: 1,
        repository: REPO,
        categories: ["Build"],
        assignments: { "build.yml": ["Missing"] },
        collapsed: [],
      },
      REPO,
    ),
  ).toThrow("Invalid category backup: categories or assignments are inconsistent.");
});

test("mergeBackup keeps existing order, unions workflows and appends new categories", () => {
  const current = [category("Build", ["a"]), category("Deploy", ["b"], true)];
  const merged = mergeBackup(current, [category("Test", ["c"]), category("build", ["a", "d"])]);
  expect(merged).toEqual([
    category("Build", ["a", "d"]),
    category("Deploy", ["b"], true),
    category("Test", ["c"]),
  ]);
  expect(current[0].workflows).toEqual(["a"]);
});

test("sameSnapshot compares names, workflows and collapsed flags", () => {
  const left = { categories: [category("A", ["x"])] };
  expect(sameSnapshot(left, { categories: [category("A", ["x"])] })).toBe(true);
  expect(sameSnapshot(left, { categories: [category("A", ["x"], true)] })).toBe(false);
  expect(sameSnapshot(left, { categories: [{ ...category("A", ["x"]), extra: 1 } as any] })).toBe(true);
  expect(sameSnapshot(left, undefined)).toBe(false);
  expect(sameSnapshot(undefined, undefined)).toBe(false);
});

test("load returns the V2 value when V1 and V2 both exist", async () => {
  const area = memoryStore({
    [`categories:${REPO}`]: { categories: [category("New")] },
    [`legacyCategories:${REPO}`]: { categories: ["Old"], assignments: {}, collapsed: [] },
  });
  expect(await load(REPO, area)).toEqual({ categories: [category("New")] });
});

test("load converts V1-only data and marks it legacy", async () => {
  const area = memoryStore({
    [`legacyCategories:${REPO}`]: { categories: ["Old"], assignments: { "a.yml": ["Old"] }, collapsed: ["Old"] },
  });
  expect(await load(REPO, area)).toEqual({ categories: [category("Old", ["a.yml"], true)], legacy: true });
});

test("load returns undefined when nothing is stored", async () => {
  expect(await load(REPO, memoryStore())).toBeUndefined();
});

test("save writes the snapshot and verifies it", async () => {
  const area = memoryStore();
  const snapshot = { categories: [category("A", ["x"])] };
  await save(REPO, snapshot, area);
  expect(area.data[`categories:${REPO}`]).toEqual(snapshot);
});

test("save throws when the read-back does not match", async () => {
  const area = memoryStore();
  area.write = async () => {};
  await expect(save(REPO, { categories: [category("A")] }, area)).rejects.toThrow(
    "Saved categories did not match the requested changes",
  );
});
