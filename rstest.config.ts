import { defineConfig } from "@rstest/core";

export default defineConfig({
  testEnvironment: {
    name: "happy-dom",
    options: {
      // jsdom-specific options
      url: "https://github.com",
      width: 1920,
      height: 1080,
    },
  },
});
