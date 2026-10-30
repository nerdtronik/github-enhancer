import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@rstest/core";
import { routeGroup, shouldFullLoad, type RouteGroup } from "../src/ts/core/routes";

type Entry = { matches: string[]; js: string[] };

const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
const entries: Entry[] = manifest.content_scripts;

const GROUP_BUNDLES: Record<RouteGroup, string[]> = {
  actions: ["workflow-filter", "run-list", "sidebar-resize", "run-view"],
  pull: ["pr-conversation", "sidebar-resize"],
};
const EVERYWHERE = ["collector-suppress", "settings", "navigation-guard", "themes", "go-to-top", "enterprise-header"];

const PATHS = [
  "/o/r/actions",
  "/o/r/actions/",
  "/o/r/actions/workflows/ci.yml",
  "/o/r/actions/runs/123",
  "/o/r/actions/runs/123/attempts/2",
  "/o/r/actions/runs/123/job/456",
  "/o/r/pull/7",
  "/o/r/pull/7/",
  "/o/r/pull/7/files",
  "/o/r/pull/7/changes",
  "/o/r/pull/7/commits",
  "/actions/actions/actions",
  "/o/pull/pull/5",
];
const NON_GROUP_PATHS = ["/", "/o", "/o/r", "/o/r/issues/3", "/o/r/blob/main/README.md"];

function matchPattern(pattern: string, url: URL): boolean {
  const parts = pattern.match(/^(https):\/\/([^/]+)(\/.*)$/);
  if (!parts) throw new Error(`unsupported match pattern: ${pattern}`);
  const [, scheme, host, path] = parts;
  const body = path.split("*").map((chunk) => chunk.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return url.protocol === `${scheme}:` && url.hostname === host && new RegExp(`^${body}$`).test(url.pathname);
}

const loadedBundles = (pathname: string): string[] => {
  const url = new URL(`https://github.com${pathname}`);
  return entries
    .filter((entry) => entry.matches.some((pattern) => matchPattern(pattern, url)))
    .flatMap((entry) => entry.js.map((js) => js.replace(/^dist\//, "").replace(/\.js$/, "")));
};

test("the match-pattern helper follows Chrome semantics", () => {
  const url = (path: string) => new URL(`https://github.com${path}`);
  expect(matchPattern("https://github.com/*/*/actions*", url("/o/r/actions"))).toBe(true);
  expect(matchPattern("https://github.com/*/*/actions*", url("/o/r/actions/runs/1"))).toBe(true);
  expect(matchPattern("https://github.com/*/*/actions*", url("/o/r"))).toBe(false);
  expect(matchPattern("https://github.com/*/*/pull/*", url("/o/r/pull"))).toBe(false);
  expect(matchPattern("https://github.com/*", url("/"))).toBe(true);
});

test("every path of a route group loads that group's bundles", () => {
  for (const path of PATHS) {
    const group = routeGroup(path);
    expect(group, path).not.toBeNull();
    const loaded = loadedBundles(path);
    for (const bundle of GROUP_BUNDLES[group!]) expect(loaded, `${path} -> ${bundle}`).toContain(bundle);
  }
});

test("the global bundles load on every GitHub path", () => {
  for (const path of [...PATHS, ...NON_GROUP_PATHS]) {
    const loaded = loadedBundles(path);
    for (const bundle of EVERYWHERE) expect(loaded, `${path} -> ${bundle}`).toContain(bundle);
  }
});

test("pull bundles never load on a path that is not under the pull group", () => {
  for (const path of NON_GROUP_PATHS) {
    const loaded = loadedBundles(path);
    expect(loaded, path).not.toContain("pr-conversation");
    expect(loaded, path).not.toContain("run-view");
  }
});

test("a full load into any group path stops the guard from reloading again", () => {
  for (const path of PATHS) {
    const group = routeGroup(path);
    expect(shouldFullLoad(path, group), path).toBe(false);
  }
});

test("only the bundles the manifest lists can be expected by a group", () => {
  const known = new Set(entries.flatMap((entry) => entry.js.map((js) => js.replace(/^dist\//, "").replace(/\.js$/, ""))));
  for (const bundle of [...Object.values(GROUP_BUNDLES).flat(), ...EVERYWHERE]) expect(known.has(bundle), bundle).toBe(true);
});
