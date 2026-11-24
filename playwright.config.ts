import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/api",
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.STRAPI_API_URL || "https://portal.faizanemadinasouthend.co.uk",
    extraHTTPHeaders: {
      "Accept": "application/json",
    },
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
