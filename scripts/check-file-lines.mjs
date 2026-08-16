// Every source file stays under the line limit. Files that were already larger when the limit
// was introduced are listed in config/file-length-baseline.json with their size at the time; a
// listed file may only shrink, and once it fits it must leave the list. `--write` lowers the
// baseline to the current sizes (never raises them, never adds files); on the very first run,
// with no baseline file yet, it records the current offenders.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const baselinePath = join(root, "config/file-length-baseline.json");
const limit = 250;
const roots = ["apps", "packages", "scripts", "e2e", "test"];
const extensions = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-e2e",
  "playwright-report",
  "test-results",
  ".local",
  "graphify-out",
  "coverage",
]);
const write = process.argv.includes("--write");

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) yield* sourceFiles(join(directory, entry.name));
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (entry.isFile() && extensions.has(extension)) yield join(directory, entry.name);
  }
}

function lineCount(path) {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")).files;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const counts = new Map();
for (const directory of roots) {
  let exists = true;
  try {
    exists = statSync(join(root, directory)).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) continue;
  for (const file of sourceFiles(join(root, directory))) {
    counts.set(relative(root, file), lineCount(file));
  }
}

const baseline = readBaseline();
const problems = [];
const nextBaseline = {};

if (baseline === null) {
  if (!write) {
    problems.push(`${relative(root, baselinePath)} is missing; run with --write to create it`);
  } else {
    for (const [file, count] of counts) if (count > limit) nextBaseline[file] = count;
  }
} else {
  for (const [file, recorded] of Object.entries(baseline)) {
    const current = counts.get(file);
    if (current === undefined) {
      problems.push(`${file}: listed in the baseline but no longer exists`);
    } else if (current <= limit) {
      problems.push(
        `${file}: now ${current} lines, within the limit — remove it from the baseline`,
      );
    } else if (current > recorded) {
      problems.push(
        `${file}: grew from ${recorded} to ${current} lines; a legacy file may only shrink`,
      );
      nextBaseline[file] = recorded;
    } else {
      nextBaseline[file] = current;
    }
  }
  for (const [file, count] of counts) {
    if (count > limit && !(file in baseline)) {
      problems.push(`${file}: ${count} lines exceeds the ${limit}-line limit`);
    }
  }
}

if (write) {
  const sorted = Object.fromEntries(
    Object.entries(nextBaseline).sort(([left], [right]) => left.localeCompare(right)),
  );
  writeFileSync(baselinePath, `${JSON.stringify({ limit, files: sorted }, null, 2)}\n`);
  // Shrinking, vanishing or growing legacy files are what --write records; only new offenders remain.
  const remaining = problems.filter((problem) => problem.includes("exceeds the"));
  if (baseline === null || remaining.length === 0) {
    console.log(
      `Baseline written: ${Object.keys(sorted).length} legacy files above ${limit} lines.`,
    );
    process.exit(0);
  }
  for (const problem of remaining) console.error(problem);
  process.exit(1);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} file-length problem(s). Limit: ${limit} lines per file.`);
  process.exit(1);
}
console.log(
  `File lengths OK: ${counts.size} files checked, ${Object.keys(baseline).length} legacy files still above ${limit} lines.`,
);
