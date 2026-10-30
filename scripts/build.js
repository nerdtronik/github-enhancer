import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const OUTPUT = "./dist";
const FEATURES = "src/ts/features";
const ICON_SOURCE = "assets/icon.svg";
const ICON_SIZES = [16, 32, 48, 128];

if (fs.existsSync(OUTPUT)) fs.rmSync(OUTPUT, { recursive: true, force: true });

const entryPoints = {
  settings: "src/ts/core/settings.ts",
  ...Object.fromEntries(
    fs
      .readdirSync(FEATURES, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(`${FEATURES}/${d.name}/index.ts`))
      .map((d) => [d.name, `${FEATURES}/${d.name}/index.ts`]),
  ),
};

await esbuild.build({
  entryPoints,
  bundle: true,
  format: "iife",
  target: ["es2020"],
  platform: "browser",
  sourcemap: false,
  minify: true,
  outdir: "dist/",
  logLevel: "warning",
});

fs.cpSync("assets/icons", `${OUTPUT}/icons`, {
  recursive: true,
});
fs.cpSync("src/css", `${OUTPUT}/css`, {
  recursive: true,
});

const iconSvg = fs.readFileSync(ICON_SOURCE);
for (const size of ICON_SIZES) {
  const png = new Resvg(iconSvg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();
  fs.writeFileSync(`${OUTPUT}/icons/icon-${size}.png`, png);
}
