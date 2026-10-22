# TypeScript Migration: Remaining Files

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate remaining JavaScript files to TypeScript and resolve all compilation errors in src/ts/run-view/ and related modules, without removing any .js files.

**Architecture:**
- Fix TypeScript errors by updating imports to use the shared namespace from src/ts/run-view/shared.ts, replacing `state.xxx` with `shared.xxx`.
- Adjust event listener typing where the original handlers expect `Event` but we pass `KeyboardEvent`/`PointerEvent`/`WheelEvent` — cast appropriately.
- Add missing declarations for `hoverFocusEnabled` and `addHoverHighlights` in the shared module.
- Once TypeScript is clean, migrate the remaining unconverted JS files into src/ts, each exporting its functions into `globalThis.__ghaRunViewModules` (or the appropriate registry).

**Tech Stack:** TypeScript (ES2020), Manifest V3 browser extension codebase, native DOM APIs.

**Spec:** User request — continue the JS→TS migration without deleting existing .js files.

## Global Constraints

- Do not remove any .js files; migration only.
- Keep existing behavior; the TypeScript version must export the same functions and attach them to the same global registry.
- The build configuration (tsconfig.json) already targets ES2020 and outputs to `dist/`.

## Review Focus

1. Missing shared namespace imports in run-view modules cause "Cannot find name" errors.
2. Event listener type mismatches: handlers typed as `Event` but passed `KeyboardEvent`, `PointerEvent`, or `WheelEvent`.
3. Missing declarations for `hoverFocusEnabled` and `addHoverHighlights` in the shared module.
4. Jobs.ts has a type mismatch where a string is passed to a numeric parameter.
5. New TypeScript files for the remaining JS modules must correctly wire their exports to `globalThis.__ghaRunViewModules`.

---

### Task 1: Fix shared.ts declarations

**Files:**
- Modify: `src/ts/run-view/shared.ts`

**Interfaces:**
- Produces: `hoverFocusEnabled` (boolean), `addHoverHighlights` (function) exported.

- [ ] **Step 1:** Add `export let hoverFocusEnabled: boolean = false;` after line 252.
- [ ] **Step 2:** Replace the stub `addHoverHighlights` with a proper delegate.
- [ ] **Step 3:** Run `npx tsc --noEmit` and verify zero errors.
- [ ] **Step 4:** Commit.

### Task 2: Fix imports and use shared namespace in run-view

**Files:**
- Modify: `src/ts/run-view/jobs.ts`
- Modify: `src/ts/run-view/toolbar.ts`

**Interfaces:**
- Consumes: `shared` exports (`jobsViewHeight`, `jobSearch`, `searchTimeout`, `applySearch`, `settingsToggleId`, `createIcon`, `searchPosition`, `arrowPlacement`, `hoverFocusEnabled`, `addHoverHighlights`).

- [ ] **Step 1 (jobs.ts):** Replace `import { ... } from 'run-view/shared'` with `import * as shared from 'run-view/shared'`. Update all references to use `shared.jobsViewHeight`, etc. Fix the type mismatch on line 263 (change the argument to a number).
- [ ] **Step 2 (toolbar.ts):** Replace `import { ... }` with `import * as shared from 'run-view/shared'`. Update every `state.xxx` to `shared.xxx`. Add `hoverFocusEnabled` variable declaration. Fix event listener type mismatches:
  - On lines ~201, ~484, ~697: cast the handler parameter to `KeyboardEvent`.
  - On lines ~479, ~689: cast to `PointerEvent`.
  - On line ~696: cast to `WheelEvent`.
- [ ] **Step 3:** Run `npx tsc --noEmit`. Expected: zero errors.
- [ ] **Step 4:** Commit both files.

### Task 3: Migrate remaining JS files to TypeScript

**Files (create new):**
- `src/ts/collector-suppress.ts`
- `src/ts/go-to-top.ts`
- `src/ts/pr-conversation.ts`
- `src/ts/run-list.ts`
- `src/ts/settings-storage.ts`
- `src/ts/sidebar-resize.ts`
- `src/ts/workflow-categories.ts`

**Interfaces:**
- Each new file exports the same functions as its JS counterpart and registers them via `globalThis.__ghaRunViewModules`.

- [ ] **Step 1:** Read each corresponding `src/js/<name>.js` to understand its public API.
- [ ] **Step 2:** For each, write a TypeScript version:
  - Declare any necessary state variables.
  - Implement the same logic.
  - At the end, attach functions to `globalThis.__ghaRunViewModules`.
- [ ] **Step 3:** For `pr-conversation.ts`, additionally ensure it registers on `window.GHAModules` as the original JS does.
- [ ] **Step 4:** After creating all files, run `npx tsc --noEmit` and verify zero errors.
- [ ] **Step 5:** Commit all new `.ts` files.

### Task 4: Final verification

**Files:** None (verification step).

- [ ] Run the full test suite: `npm test`.
- [ ] Confirm all tests pass.

---

**Plan complete and saved to `docs/superpowers/plans/2026-10-22-ts-migration.md`. Please review the plan. Which execution approach would you prefer?**

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, then one fresh reviewer checks the whole branch. Cheapest and fastest; no independent review until the end.

**For this plan I recommend Native, because the tasks are tightly coupled (the shared namespace must be fixed before any other run-view file can compile) and the user explicitly requested to continue in this session. Does the plan capture what you want, and should we proceed with Native execution?**
