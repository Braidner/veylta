import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const testRoot = await mkdtemp(join(tmpdir(), "veylta-e2e-"));
const isolatedNextDirectoryName = `.next-playwright-${process.env.PLAYWRIGHT_WEB_PORT ?? "4400"}`;
const isolatedNextDirectory = join(projectRoot, "apps", "web", isolatedNextDirectoryName);
const fakeBin = join(testRoot, "bin");
await mkdir(fakeBin, { recursive: true });
const fakeCodex = join(fakeBin, "codex");
await writeFile(
  fakeCodex,
  `#!/usr/bin/env node\nimport ${JSON.stringify(new URL("./fake-codex.mjs", import.meta.url).href)};\n`,
  { mode: 0o700 },
);
await chmod(fakeCodex, 0o700);
const environment = {
  ...process.env,
  DATABASE_PATH: join(testRoot, "veylta.sqlite"),
  OBJECT_STORAGE_ROOT: join(testRoot, "storage"),
  PROCESSING_POLL_INTERVAL_MS: "50",
  PROCESSING_RETRY_DELAY_MS: "50",
  NEXT_DIST_DIR: isolatedNextDirectoryName,
  PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
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
  await run(["exec", "playwright", "test", ...process.argv.slice(2)]);
} finally {
  await Promise.all([
    rm(testRoot, { force: true, recursive: true }),
    rm(isolatedNextDirectory, { force: true, recursive: true }),
  ]);
}
