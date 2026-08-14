import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = false;
const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "4400";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "4401";
const workerPort = process.env.PLAYWRIGHT_WORKER_PORT ?? "4402";
const nextDistDir = process.env.PLAYWRIGHT_NEXT_DIST_DIR ?? ".next-e2e";
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const workerOrigin = `http://127.0.0.1:${workerPort}`;

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
    baseURL: webOrigin,
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
      url: `${apiOrigin}/healthz`,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: {
        ...process.env,
        API_PORT: apiPort,
        DEMO_REGISTRATION_ENABLED: "true",
        WEB_ORIGIN: webOrigin,
        WEB_ORIGINS: webOrigin,
      },
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: "node --import tsx src/worker.ts",
      cwd: "apps/api",
      url: `${workerOrigin}/healthz`,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: { ...process.env, WORKER_HEALTH_PORT: workerPort },
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${webPort}`,
      cwd: "apps/web",
      url: webOrigin,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: {
        ...process.env,
        API_INTERNAL_URL: apiOrigin,
        NEXT_DIST_DIR: nextDistDir,
        WEB_ORIGINS: webOrigin,
      },
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
});
