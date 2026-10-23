#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const DIST_DIR = path.join(__dirname, "..", "dist");

function stripExportsAndWrap(content) {
  const lines = content.split('\n');
  console.log(`\nProcessing file: ${content.substring(0, 50)}...`);
  console.log(`Total lines: ${lines.length}`);

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const isExport = /^\s*export\b/i.test(lines[i]);
    if (isExport) {
      console.log(`  Export line ${i}: ${JSON.stringify(lines[i])}`);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*export\b/i.test(lines[i])) continue;
  }

  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*export\b/i.test(lines[i])) continue;
    filtered.push(lines[i]);
  }

  console.log(`Filtered: ${lines.length} -> ${filtered.length} lines`);
  return `(function() {\n${filtered.join('\n')}\n})();`;
}

const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });

for (const entry of entries) {
  if (entry.isDirectory()) {
    console.log(`\n=== Directory: ${entry.name} ===`);
    const subEntries = fs.readdirSync(path.join(DIST_DIR, entry.name), { withFileTypes: true });
    for (const subEntry of subEntries) {
      if (subEntry.isFile() && subEntry.name.endsWith(".js")) {
        console.log(`File: ${subEntry.name}`);
        const filePath = path.join(DIST_DIR, entry.name, subEntry.name);
        const content = fs.readFileSync(filePath, "utf8");

        if (/^\s*export\b/i.test(content)) {
          console.log(`  -> Has exports, will wrap`);
          const processed = stripExportsAndWrap(content);
          fs.writeFileSync(filePath, processed);
        } else {
          console.log(`  -> No exports at top, skipping`);
        }
      }
    }
  }
}

console.log("\nBuild complete!");
