import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const testRoot = await mkdtemp(join(tmpdir(), "veylta-e2e-"));
const environment = {
  ...process.env,
  DATABASE_PATH: join(testRoot, "veylta.sqlite"),
  OBJECT_STORAGE_ROOT: join(testRoot, "storage"),
  PROCESSING_POLL_INTERVAL_MS: "50",
  PROCESSING_RETRY_DELAY_MS: "50",
};
function run(arguments_, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, arguments_, {
      cwd: projectRoot,
      env: { ...environment, ...extraEnvironment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm ${arguments_.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

try {
  await run(["--filter", "@veylta/api", "db:migrate"]);
  await run(["exec", "playwright", "test"]);
} finally {
  await rm(testRoot, { force: true, recursive: true });
}
