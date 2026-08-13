import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = false;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === "true",
  retries: process.env.CI === "true" ? 1 : 0,
  reporter: process.env.CI === "true" ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4300",
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
      command: "node --import tsx src/server.ts",
      cwd: "apps/api",
      url: "http://127.0.0.1:4301/healthz",
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: {
        ...process.env,
        DEMO_REGISTRATION_ENABLED: "true",
        WEB_ORIGIN: "http://127.0.0.1:4300",
      },
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: "node --import tsx src/worker.ts",
      cwd: "apps/api",
      url: "http://127.0.0.1:4302/healthz",
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: process.env,
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 4300",
      cwd: "apps/web",
      url: "http://127.0.0.1:4300",
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: process.env,
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
});
