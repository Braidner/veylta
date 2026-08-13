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
  `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli 0.147.0\\n");
} else if (args[0] === "login" && args[1] === "status") {
  process.stderr.write("Logged in using ChatGPT\\n");
} else if (args[0] === "app-server" && args[1] === "daemon" && args[2] === "version") {
  process.stdout.write('{"appServerVersion":"0.147.0"}\\n');
} else if (args[0] === "app-server" && args[1] === "daemon" && args[2] === "start") {
  process.stdout.write("started\\n");
} else if (args[0] === "exec") {
  const marker = args.indexOf("--output-last-message");
  if (marker < 0 || args[marker + 1] === undefined) process.exit(2);
  await writeFile(args[marker + 1], JSON.stringify({ items: [
    { category: "laboratory", sourceObservationIndex: 0, missingContext: ["sample_date"] },
    { category: "nutrition", sourceObservationIndex: null, missingContext: ["dietary_restrictions"] }
  ] }));
} else {
  process.exit(2);
}
`,
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
  await run(["exec", "playwright", "test"]);
} finally {
  await Promise.all([
    rm(testRoot, { force: true, recursive: true }),
    rm(isolatedNextDirectory, { force: true, recursive: true }),
  ]);
}
