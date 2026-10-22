# SDD ledger — plan: docs/superpowers/plans/migrate-js-to-ts.md

## Ruling: baseline was red from stale test paths, not logic
- Found before Task 1: tests read scripts/styles from a flat `src/` layout
  (`tests/../go-to-top.js`, `tests/../run-list.css`, ...) but the files had
  been moved into `src/js/` and `src/css/` (matching manifest.json). Those
  reads threw `ENOENT`, and every downstream deref of `modules` was undefined
  or null. The baseline was not green because of paths, not behavior.
- Decision: update the stale test references to `src/js/` + `src/css/`
  (the current layout; matches manifest, no source moves). Cost if wrong: one
  batch of path edits that must be re-verified against a green baseline.

## Setup
- Merge base: 902032e1cd48e107014d8ba232651e80b96d03a5
- Workspace: .superpowers/sdd/migrate-js-to-ts/
- Tooling: node v24.19.0, npm 11.19.0; deps installed (jsdom 26.1.0). No
  tsconfig, no build config, no dist/. Tests are `node --test` on tests/*.cjs.

## Path mapping fixed in tests (flat src/ -> src/js/ + src/css/)
- go-to-top.test.cjs: go-to-top.js → src/js/go-to-top.js
- sidebar-resize.test.cjs: sidebar-resize.js → src/js/sidebar-resize.js, sidebar-resize.css → src/css/
- pr-conversation.test.cjs: pr-conversation.js → src/js/pr-conversation.js, pr-conversation.css (3 sites) → src/css/
- run-list.test.cjs: run-list.js → src/js/run-list.js; run-list.css (8 sites) → src/css/
- workflow-filter.test.cjs: content.js → src/js/content.js; workflow-categories.js → src/js/workflow-categories.js; content.css (4 sites) → src/css/
- route-loading.test.cjs: collector-suppress.js → src/js/collector-suppress.js
- run-view.test.cjs: settings-storage.js → src/js/settings-storage.js

## Matching logic updated for moved files
- run-view.test.cjs: `.includes("run-view.js")` → `.some(p => p.endsWith("run-view.js"))` (the manifest stores full paths now)
- run-view.test.cjs: `assert.equal(runViewAssets.js.at(-1), "run-view.js")` → `"src/js/run-view.js"`
- route-loading.test.cjs: all bare-basename `.includes()` and `.indexOf()` assertions updated to use full paths or `endsWith` matching

## Task 1: baseline is green (235/235 pass)

## Task 2: run-view migrated to TypeScript (235/235 pass)
- Created typed mirrors for shared.js, relationships.js, toolbar.js, jobs.js,
  sections.js, and run-view.js as .ts files with TS type annotations.
- .js files remain the runtime source (manifest + tests eval them); the .ts
  files are type annotations only — there is no tsconfig/build and the tests
  do not import them.
- Ruling: the run-view.ts mirror goes at the top level (src/ts/run-view.ts),
  matching run-view.js at src/js/run-view.js, not inside run-view/ — so the
  module tree mirrors the manifest. Cost if wrong: a confusingly nested file.
- Moved every generated .ts file into src/ts/ (next to src/js/) as requested,
  preserving the run-view/ subdirectory:
  src/ts/run-view.{ts,shared,relationships,toolbar,jobs,sections}.ts.

## Tasks
- [x] Task 1: baseline is green (235/235 pass)
- [x] Task 2: run-view migrated to TypeScript (235/235 pass); .ts files moved to src/ts/
