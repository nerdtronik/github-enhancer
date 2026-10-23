import { defineConfig, js, ts } from '@rslint/core';

export default defineConfig([
  js.configs.recommended,
  ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
    files: ["src/**/*.ts", "src/**/*.css"],
    ignores: ["dist/**"],
  },
]);
