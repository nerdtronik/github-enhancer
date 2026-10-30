import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

const OUTPUT_DIR = "release";
const FILES = ["manifest.json", "LICENSE.md", "THIRD_PARTY_NOTICES.md", "dist"];

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const archive = `${OUTPUT_DIR}/github-enhancer-${version}.zip`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.rmSync(archive, { force: true });
execFileSync("zip", ["-r", "-X", "-q", archive, ...FILES], { stdio: "inherit" });

const listing = execFileSync("zip", ["-sf", archive], { encoding: "utf8" });
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const referenced = [
  ...Object.values(manifest.icons ?? {}),
  ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css ?? [])]),
];
const missing = referenced.filter((path) => !listing.includes(path));
if (missing.length) {
  console.error(`Bundle is missing files referenced by manifest.json:\n${missing.join("\n")}`);
  process.exit(1);
}
console.log(`${archive} (${referenced.length} manifest files verified)`);
