#!/usr/bin/env ts-node/esm
/**
 * Build script for TypeScript browser extension modules.
 * Wraps each run-view module in a unique namespace to avoid global collisions.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// First compile TypeScript with commonjs
execSync(`cd ${PROJECT_ROOT} && npx tsc`, { stdio: "inherit" });

// Then wrap run-view modules in unique namespaces
const runViewDir = path.join(PROJECT_ROOT, "dist", "run-view");
if (fs.existsSync(runViewDir)) {
  const files = fs.readdirSync(runViewDir);

  for (const file of files) {
    if (!file.endsWith(".js")) continue;

    const content = fs.readFileSync(path.join(runViewDir, file), "utf8");

    // Skip the main entry file
    if (file === "run-view.js") continue;

    let wrapped = content;

    // Extract filename for namespace
    const name = path.basename(file, ".js");

    // Wrap in a unique namespace IIFE to avoid global collisions
    wrapped = `(function() {` + "\n" +
      "  var __namespace__ = function() {" + "\n" +
      content + "\n" +
      "}();\n" +
    `})();`;

    fs.writeFileSync(path.join(runViewDir, file), wrapped);
  }
}

console.log("Build complete!");
