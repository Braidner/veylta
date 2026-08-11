import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = process.env.CI !== "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: process.env.CI === "true",
  retries: process.env.CI === "true" ? 1 : 0,
  reporter: process.env.CI === "true" ? "github" : "list",
  use: {
    baseURL: "http://localhost:4300",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @family-health/api dev:api",
      url: "http://127.0.0.1:4301/healthz",
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @family-health/api dev:worker",
      url: "http://127.0.0.1:4302/healthz",
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @family-health/web dev",
      url: "http://127.0.0.1:4300",
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
});
