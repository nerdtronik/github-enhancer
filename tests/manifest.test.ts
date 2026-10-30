import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";

type Entry = {
  matches: string[];
  js: string[];
  css?: string[];
  world?: string;
  run_at: string;
};

const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const entries: Entry[] = manifest.content_scripts;
const jsPaths = entries.flatMap((entry) => entry.js);
const cssPaths = entries.flatMap((entry) => entry.css ?? []);
const features = readdirSync(join(root, "src/ts/features")).filter((name) =>
  existsSync(join(root, "src/ts/features", name, "index.ts")),
);
const entryFor = (bundle: string) =>
  entries.find((entry) => entry.js.includes(`dist/${bundle}.js`));

describe("manifest content scripts", () => {
  test("js paths map to a bundle source", () => {
    for (const path of jsPaths) {
      const name = path.match(/^dist\/([^/]+)\.js$/)?.[1];
      expect(name, path).toBeDefined();
      expect(name === "settings" || features.includes(name!), path).toBe(true);
    }
  });

  test("css paths map to a source stylesheet", () => {
    for (const path of cssPaths) {
      const rel = path.match(/^dist\/css\/(.+)$/)?.[1];
      expect(rel, path).toBeDefined();
      expect(existsSync(join(root, "src/css", rel!)), path).toBe(true);
    }
  });

  test("no js or css path is listed twice within entries sharing a match pattern", () => {
    const byMatch = new Map<string, string[]>();
    for (const entry of entries)
      for (const match of entry.matches)
        byMatch.set(match, [...(byMatch.get(match) ?? []), ...entry.js, ...(entry.css ?? [])]);
    for (const [match, paths] of byMatch) expect(new Set(paths).size, match).toBe(paths.length);
  });

  test("every feature bundle is referenced by at least one entry", () => {
    for (const name of features) expect(entryFor(name), name).toBeDefined();
  });

  test("worlds and run_at", () => {
    expect(entryFor("run-view")?.world).toBe("MAIN");
    expect(entryFor("collector-suppress")?.world).toBe("MAIN");
    expect(entryFor("collector-suppress")?.run_at).toBe("document_start");
  });

  test("route-family entries use narrow match patterns", () => {
    const actions = ["https://github.com/*/*/actions*"];
    const pull = ["https://github.com/*/*/pull/*"];
    const bundles = (entry?: Entry) => entry?.js.map((path) => path.replace(/^dist\/|\.js$/g, ""));
    expect(entryFor("workflow-filter")?.matches).toEqual(actions);
    expect(bundles(entryFor("workflow-filter"))).toEqual(["workflow-filter", "run-list", "sidebar-resize"]);
    expect(entryFor("run-view")?.matches).toEqual(actions);
    expect(entryFor("run-view")?.js).toEqual(["dist/run-view.js"]);
    expect(entryFor("pr-conversation")?.matches).toEqual(pull);
    expect(bundles(entryFor("pr-conversation"))).toEqual(["pr-conversation", "sidebar-resize"]);
    for (const name of ["workflow-filter", "run-view", "pr-conversation"])
      expect(entryFor(name)?.run_at, name).toBe("document_idle");
  });

  test("global entries match all of github.com", () => {
    for (const name of ["collector-suppress", "settings", "navigation-guard", "themes", "go-to-top", "enterprise-header"])
      expect(entryFor(name)?.matches, name).toEqual(["https://github.com/*"]);
    expect(entryFor("settings")?.run_at).toBe("document_start");
    expect(entryFor("navigation-guard")?.run_at).toBe("document_start");
    expect(entryFor("themes")?.run_at).toBe("document_start");
    expect(entryFor("themes")?.world).toBeUndefined();
    expect(entryFor("themes")?.js).toEqual(["dist/settings.js", "dist/navigation-guard.js", "dist/themes.js"]);
    expect(entryFor("themes")?.css).toEqual(["dist/css/themes.css"]);
    expect(entryFor("enterprise-header")?.run_at).toBe("document_idle");
    expect(entryFor("enterprise-header")?.world).toBeUndefined();
    expect(entryFor("enterprise-header")?.js).toEqual(["dist/go-to-top.js", "dist/enterprise-header.js"]);
    expect(entryFor("enterprise-header")?.css).toEqual(["dist/css/go-to-top.css", "dist/css/enterprise-header.css"]);
  });

  const built = existsSync(join(root, "dist"));
  test.skipIf(!built)("every referenced file exists in dist (skipped without a build)", () => {
    for (const path of [...jsPaths, ...cssPaths]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  });
});
