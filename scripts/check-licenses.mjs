import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const policy = JSON.parse(
  await readFile(new URL("../config/license-policy.json", import.meta.url), "utf8"),
);

const result = spawnSync("pnpm", ["licenses", "list", "--json"], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout);
const allowed = new Set(policy.allowedLicenses);
const reviewedExpressions = new Set(policy.reviewedExpressions);
const exceptions = new Map(Object.entries(policy.packageExceptions));
const usedExceptions = new Set();
const rejected = [];

for (const [license, packages] of Object.entries(report)) {
  if (!Array.isArray(packages)) {
    throw new Error(`Unexpected pnpm license report entry for ${license}`);
  }
  for (const entry of packages) {
    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    for (const version of versions) {
      const packageId = `${entry.name}@${version}`;
      const exception = exceptions.get(packageId);
      if (exception !== undefined && exception.license === license) {
        usedExceptions.add(packageId);
      }
      const accepted =
        allowed.has(license) ||
        reviewedExpressions.has(license) ||
        (exception !== undefined && exception.license === license);

      if (!accepted) {
        rejected.push(`${packageId}: ${license}`);
      }
    }
  }
}

for (const packageId of exceptions.keys()) {
  if (!usedExceptions.has(packageId)) {
    rejected.push(`${packageId}: stale or missing reviewed exception`);
  }
}

if (rejected.length > 0) {
  console.error("Dependency license policy rejected:");
  for (const item of rejected.sort()) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log(
  `Dependency license policy passed for ${Object.keys(report).length} license groups and ${usedExceptions.size} exact exceptions.`,
);
