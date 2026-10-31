import { expect, test } from "@rstest/core";
import { isValidPreference } from "../src/ts/core/settings";
import { validateTheme, type Theme } from "../src/ts/features/themes/theme";
import { loadCustomThemes, saveCustomThemes } from "../src/ts/features/themes/themeStore";
import dracula from "./fixtures/themes/dracula.json";
import "./shipped-themes";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const themed = (id: string): Theme => validateTheme({ ...clone(dracula), id, name: id });

function memoryStore(initial: unknown = undefined) {
  const data: Record<string, unknown> = initial === undefined ? {} : { themes: initial };
  return {
    data,
    async read(name: string) {
      return structuredClone(data[name]);
    },
    async write(name: string, _id: string | undefined, value: unknown) {
      data[name] = structuredClone(value);
    },
  } as any;
}

test("load of nothing is empty", async () => {
  expect(await loadCustomThemes(memoryStore())).toEqual([]);
  expect(await loadCustomThemes(memoryStore("junk"))).toEqual([]);
  expect(await loadCustomThemes(memoryStore({ themes: "x" }))).toEqual([]);
});

test("load drops a corrupt entry and keeps the good ones", async () => {
  const bad = clone(dracula) as any;
  bad.id = "custom-bad";
  delete bad.palette.pink;
  const area = memoryStore({ themes: [themed("custom-a"), bad, themed("custom-b")] });
  const result = await loadCustomThemes(area);
  expect(result.map((theme) => theme.id)).toEqual(["custom-a", "custom-b"]);
});

test("load drops built-in ids", async () => {
  const area = memoryStore({ themes: [themed("dracula"), themed("custom-a")] });
  expect((await loadCustomThemes(area)).map((theme) => theme.id)).toEqual(["custom-a"]);
});

test("load keeps the first of duplicate ids", async () => {
  const first = { ...themed("custom-a"), name: "First" };
  const second = { ...themed("custom-a"), name: "Second" };
  const result = await loadCustomThemes(memoryStore({ themes: [first, second] }));
  expect(result.map((theme) => theme.name)).toEqual(["First"]);
});

test("load returns at most 200 themes", async () => {
  const themes = Array.from({ length: 250 }, (_, index) => themed(`custom-${index}`));
  expect(await loadCustomThemes(memoryStore({ themes }))).toHaveLength(200);
});

test("save then load round-trips", async () => {
  const area = memoryStore();
  const themes = [themed("custom-a"), themed("custom-b")];
  await saveCustomThemes(themes, area);
  expect(await loadCustomThemes(area)).toEqual(themes);
});

test("save throws a distinct error when nothing can be read back", async () => {
  const area = memoryStore();
  area.write = async () => {};
  await expect(saveCustomThemes([themed("custom-a")], area)).rejects.toThrow(
    "Could not read the saved themes back from extension storage",
  );
});

function scripted(reads: (written: any) => unknown[]) {
  let written: any;
  let count = 0;
  return {
    reads: () => count,
    area: {
      async write(_name: string, _id: string | undefined, value: unknown) {
        written = structuredClone(value);
      },
      async read() {
        const answers = reads(written);
        return structuredClone(answers[Math.min(count++, answers.length - 1)]);
      },
    } as any,
  };
}

const reversed = (value: any): any =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]))
    : value;

test("read-back with a different key order passes", async () => {
  const { area } = scripted((w) => [{ themes: w.themes.map(reversed) }]);
  await expect(saveCustomThemes([themed("custom-a"), themed("custom-b")], area)).resolves.toBeUndefined();
});

test("read-back with extra unknown properties passes", async () => {
  const { area } = scripted((w) => [
    { themes: w.themes.map((t: any) => ({ ...t, extra: 1, palette: { ...t.palette, unknown: "x" } })), more: true },
  ]);
  await expect(saveCustomThemes([themed("custom-a")], area)).resolves.toBeUndefined();
});

test("a stale first read-back passes after one retry", async () => {
  const store = scripted((w) => [{ themes: [] }, w]);
  await saveCustomThemes([themed("custom-a")], store.area);
  expect(store.reads()).toBe(2);
});

function captureWarn() {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void calls.push(args);
  return { calls, restore: () => void (console.warn = original) };
}

test("a permanent mismatch throws an actionable error without names or colors", async () => {
  const warn = captureWarn();
  const secret = validateTheme({ ...clone(dracula), id: "custom-a", name: "SECRET-NAME" });
  const store = scripted((w) => [{ themes: [w.themes[0]] }]);
  const error = await saveCustomThemes([secret, themed("custom-b")], store.area).catch((e: Error) => e);
  warn.restore();
  expect(store.reads()).toBe(2);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain("Saved themes did not match what was written (expected 2 themes, found 1: custom-b)");
  expect(message).toContain("Reload the page and try again");
  expect(warn.calls).toEqual([["Themes: read-back mismatch", { expected: ["custom-a", "custom-b"], found: ["custom-a"] }]]);
  const everything = message + JSON.stringify(warn.calls);
  expect(everything).not.toContain("SECRET");
  expect(everything).not.toMatch(/#[0-9a-f]{3}/i);
});

test("an unreadable read-back is a mismatch", async () => {
  const warn = captureWarn();
  const store = scripted(() => [{ themes: "junk" }]);
  const error = await saveCustomThemes([themed("custom-a")], store.area).catch((e: Error) => e);
  warn.restore();
  expect((error as Error).message).toContain("expected 1 themes, found 0");
  expect(warn.calls[0][1]).toEqual({ expected: ["custom-a"], found: "unreadable" });
});

test("an invalid stored entry is a mismatch, not silently dropped", async () => {
  const warn = captureWarn();
  const store = scripted((w) => [{ themes: [{ ...w.themes[0], palette: {} }] }]);
  const error = await saveCustomThemes([themed("custom-a")], store.area).catch((e: Error) => e);
  warn.restore();
  expect((error as Error).message).toContain("found 1: custom-a");
});

test("save throws and writes nothing for an invalid theme", async () => {
  const area = memoryStore();
  const bad = clone(dracula) as any;
  delete bad.palette.pink;
  await expect(saveCustomThemes([themed("custom-a"), bad], area)).rejects.toThrow();
  expect(area.data).toEqual({});
});

test("save throws and writes nothing above 200 themes", async () => {
  const area = memoryStore();
  const themes = Array.from({ length: 201 }, (_, index) => themed(`custom-${index}`));
  await expect(saveCustomThemes(themes, area)).rejects.toThrow("Too many custom themes (max 200)");
  expect(area.data).toEqual({});
});

test("theme preferences accept null or a slug and reject everything else", () => {
  for (const key of ["appearance_lightTheme", "appearance_darkTheme"] as const) {
    expect(isValidPreference(key, null)).toBe(true);
    expect(isValidPreference(key, "dracula")).toBe(true);
    expect(isValidPreference(key, "custom-1a2b3c4d")).toBe(true);
    for (const bad of [5, "", "Dracula", "a b", "-a", "a".repeat(65)])
      expect(isValidPreference(key, bad)).toBe(false);
  }
});

test("existing preference validation is unchanged", () => {
  expect(isValidPreference("actionRun_hoverFocusEnabled", true)).toBe(true);
  expect(isValidPreference("actionRun_hoverFocusEnabled", "x")).toBe(false);
});
