#!/usr/bin/env node
/**
 * Post-process TypeScript output for browser extension loading.
 * Strips top-level exports and wraps each file in an IIFE.
 */

const fs = require("fs");
const path = require("path");

const DIST_DIR = path.join(__dirname, "..", "dist");

function stripExportsAndWrap(content) {
  const lines = content.split('\n');
  const filtered = [];

  for (let i = 0; i < lines.length; i++) {
    // Skip lines that contain export keyword at the start
    if (/^\s*export\b/i.test(lines[i])) continue;
    filtered.push(lines[i]);
  }

  return `(function() {\n${filtered.join('\n')}\n})();`;
}

// Process all .js files in dist folder
const files = fs.readdirSync(DIST_DIR);

for (const file of files) {
  if (!file.endsWith(".js") || file === "run-view.js") continue;

  const filePath = path.join(DIST_DIR, file);
  let content = fs.readFileSync(filePath, "utf8");

  // Skip collector-suppress since it's already in IIFE format
  if (file === "collector-suppress.js") continue;

  console.log(`Processing ${file} (${content.length} bytes)...`);

  const beforeLines = content.split('\n').filter(l => /^\s*export\b/i.test(l)).length;
  content = stripExportsAndWrap(content);
  const afterLines = content.split('\n').filter(l => /^\s*export\b/i.test(l)).length;

  console.log(`  Stripped ${beforeLines} export lines, now ${afterLines} exports`);

  fs.writeFileSync(filePath, content);
}

console.log("Build complete!");
