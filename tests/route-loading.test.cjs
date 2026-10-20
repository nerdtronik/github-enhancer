const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const root = `${__dirname}/..`;
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
const collectorScript = readFileSync(`${root}/collector-suppress.js`, "utf8");

test("one MV3 manifest loads every feature without a background process", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background, undefined);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  for (const entry of manifest.content_scripts) {
    assert.deepEqual(entry.matches, ["https://github.com/*"]);
    for (const file of [...entry.js, ...(entry.css ?? [])])
      assert.ok(existsSync(`${root}/${file}`), `Missing manifest asset: ${file}`);
  }
  const scripts = manifest.content_scripts.flatMap(({ js }) => js);
  assert.ok(scripts.indexOf("workflow-categories.js") < scripts.indexOf("content.js"));
  assert.ok(scripts.includes("sidebar-resize.js"));
  assert.ok(scripts.includes("pr-conversation.js"));
  assert.ok(scripts.includes("run-list.js"));
  assert.ok(scripts.includes("go-to-top.js"));
  const settings = manifest.content_scripts.find(({ js }) => js.includes("settings-storage.js"));
  const runView = manifest.content_scripts.find(({ js }) => js.includes("run-view.js"));
  assert.equal(settings.run_at, "document_start");
  assert.equal(runView.world, "MAIN");
  assert.equal(runView.run_at, "document_start");
  assert.ok(runView.js.indexOf("run-view/shared.js") < runView.js.indexOf("run-view.js"));
});

test("the telemetry guard loads before GitHub scripts", () => {
  const entry = manifest.content_scripts.find(({ js }) => js.includes("collector-suppress.js"));
  assert.equal(entry.world, "MAIN");
  assert.equal(entry.run_at, "document_start");
});

test("suppresses GitHub telemetry on Actions routes without changing other requests", async (t) => {
  const dom = new JSDOM("<main></main>", {
    url: "https://github.com/owner/repo/actions",
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const fetched = [];
  const beacons = [];
  window.Response = Response;
  window.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(null, { status: 200 });
  };
  window.navigator.sendBeacon = (url) => {
    beacons.push(String(url));
    return false;
  };
  window.eval(collectorScript);

  const collector = "https://collector.github.com/github/collect";
  const stats = "https://api.github.com/_private/browser/stats";
  assert.equal((await window.fetch(collector)).status, 204);
  assert.equal(window.navigator.sendBeacon(collector, "telemetry"), true);
  assert.equal((await window.fetch(stats)).status, 204);
  assert.equal(window.navigator.sendBeacon(stats, "telemetry"), true);
  assert.deepEqual(fetched, []);
  assert.deepEqual(beacons, []);

  await window.fetch("/owner/repo/actions/_workflows");
  assert.equal(window.navigator.sendBeacon("https://example.com/collect", "other"), false);
  window.history.pushState({}, "", "/owner/repo");
  await window.fetch(collector);
  await window.fetch(stats);
  assert.equal(window.navigator.sendBeacon(collector, "telemetry"), false);
  assert.equal(window.navigator.sendBeacon(stats, "telemetry"), false);
  assert.deepEqual(fetched, ["/owner/repo/actions/_workflows", collector, stats]);
  assert.deepEqual(beacons, ["https://example.com/collect", collector, stats]);
});
