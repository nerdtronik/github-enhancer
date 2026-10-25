import * as esbuild from "esbuild";
import * as fs from "node:fs";

// The run-view group shares a globalThis registry (shared.ts publishes
// __ghaRunViewModules, the rest read/extend it) and declares several top-level
// names in more than one file. Bundling the group into a single IIFE lets
// esbuild preserve each module's original scope — renaming collisions like
// statusOptions -> statusOptions2 — while keeping the execution order that the
// registry depends on. The other groups have no shared state and are bundled
// the same way, one file per manifest entry.
const RUN_VIEW_ENTRY = "src/ts/run-view/_bundle-entry.ts";

const writeEntry = () => {
  // Imports resolved relative to the generated entry file, in the order the
  // registry contract requires (shared publishes first, run-view reads last).
  const modules = ["./shared", "./relationships", "./toolbar", "./jobs", "./sections", "../run-view"];
  const spec = modules.map((m) => `import ${JSON.stringify(m)};`).join("\n") + "\n";
  fs.writeFileSync(RUN_VIEW_ENTRY, spec);
};

const build = async (entry, outfile) => {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    target: ["es2020"],
    platform: "browser",
    sourcemap: true,
    outfile,
    logLevel: "warning",
  });
};

writeEntry();
await build(RUN_VIEW_ENTRY, "dist/run-view.js");
await build("src/ts/content.ts", "dist/content.js");
await build("src/ts/collector-suppress.ts", "dist/collector-suppress.js");
await build("src/ts/settings-storage.ts", "dist/settings-storage.js");
await build("src/ts/go-to-top.ts", "dist/go-to-top.js");
await build("src/ts/sidebar-resize.ts", "dist/sidebar-resize.js");
await build("src/ts/workflow-categories.ts", "dist/workflow-categories.js");
await build("src/ts/pr-conversation.ts", "dist/pr-conversation.js");
await build("src/ts/run-list.ts", "dist/run-list.js");

fs.rmSync(RUN_VIEW_ENTRY);
