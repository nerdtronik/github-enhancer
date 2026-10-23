// rollup.config.mjs
// import json from "@rollup/plugin-json";

export default {
  input: "src/**/*.ts",
  output: {
    file: "bundle.js",
    format: "cjs",
  },
  // plugins: [json()],
};
