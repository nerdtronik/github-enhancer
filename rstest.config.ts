import { defineConfig } from "@rstest/core";

export default defineConfig({
  testEnvironment: {
    name: "happy-dom",
    options: {
      // happy-dom options
      url: "https://github.com",
      width: 1920,
      height: 1080,
    },
  },
});
