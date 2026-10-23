#!/usr/bin/env node
/**
 * Post-process TypeScript output for browser extension loading.
 * Wraps each file in an IIFE to avoid global scope pollution.
 */

const fs = require("fs");
const path = require("path");

// Get the project root (where package.json is)
const PROJECT_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

// Recursively process all .js files in dist folder
function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      console.log(`Processing: ${entry.name}`);
      // Skip the main entry file and collector-suppress
      if (entry.name === "run-view.js" || entry.name === "collector-suppress.js") {
        console.log(`  -> Skipping ${entry.name}`);
        continue;
      }

      // Only process files from the run-view subdirectory (TypeScript output)
      if (!fullPath.includes('/run-view/')) {
        console.log(`  -> Skipping non-run-view file: ${entry.name}`);
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf8");
      // Preserve the relative subdirectory path (e.g., dist/run-view/shared.js)
      const relPath = fullPath.substring(DIST_DIR.length + 1);
      const filePath = path.join(DIST_DIR, relPath);
      const lines = content.split('\n');
      const filtered = [];

      console.log(`  DEBUG: Reading ${fullPath} -> ${filePath}, ${lines.length} lines`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip ES6 export statements and TS CommonJS __esModule stubs
        const isExport = /^\s*export\b/i.test(line);
        const isEsModule = /__esModule.*exports|exports\.__esModule|Object\.defineProperty.*exports.*__esModule/.test(line);
        const isTsExports = /^(\s*)exports\./i.test(line);
        if (isExport || isEsModule || isTsExports) {
          console.log(`  -> SKIP at ${entry.name}:${i} [exp=${isExport}, esm=${isEsModule}, ts=${isTsExports}]`);
        } else {
          filtered.push(line);
        }
      }

      const wrapped = `(function() {\n${filtered.join('\n')}\n})();`;
      console.log(`  DEBUG: Wrapping ${filtered.length} lines into ${wrapped.length} chars`);

      try {
        // Write to a temp file first, then rename for atomicity
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, wrapped);
        fs.renameSync(tmpPath, filePath);
        console.log(`  -> WRITTEN: ${filePath.substring(filePath.lastIndexOf('/') + 1)}`);
      } catch (err) {
        console.error(`  -> ERROR writing ${filePath}:`, err.message);
      }
    }
  }
}

processDirectory(DIST_DIR);
console.log("Build complete!");
