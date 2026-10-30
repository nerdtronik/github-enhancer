import { defineConfig, js, ts } from '@rslint/core';

export default defineConfig([
  { ignores: ["dist/**", "release/**"] },
  js.configs.recommended,
  ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
    files: ["src/**/*.ts", "src/**/*.css", "tests/**/*.ts"],
    ignores: ["dist/**"],
  },
]);
