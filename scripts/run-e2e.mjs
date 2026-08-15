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
import { readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli 0.147.0\\n");
} else if (args[0] === "login" && args[1] === "status") {
  process.stderr.write("Logged in using ChatGPT\\n");
} else if (args[0] === "app-server" && args.length === 1) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\\n")) {
      const newline = buffer.indexOf("\\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      if (message.id === 1) {
        process.stdout.write(JSON.stringify({ id: 1, result: { appServerVersion: "0.147.0" } }) + "\\n");
      } else if (message.id === 2) {
        process.stdout.write(JSON.stringify({ id: 2, result: { data: [
          {
            id: "gpt-5.6-sol",
            displayName: "GPT-5.6 Sol",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort })),
            serviceTiers: [{ id: "default" }, { id: "priority" }],
            upgrade: null
          },
          {
            id: "gpt-5.6-luna",
            displayName: "GPT-5.6 Luna",
            isDefault: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({ reasoningEffort })),
            serviceTiers: [{ id: "default" }, { id: "priority" }],
            upgrade: null
          }
        ] } }) + "\\n");
      } else if (message.id === 3) {
        process.stdout.write(JSON.stringify({ id: 3, result: { rateLimits: {
          primary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: 1787056800 }
        } } }) + "\\n");
      }
    }
  });
} else if (args[0] === "app-server" && args[1] === "daemon" && args[2] === "version") {
  process.stdout.write('{"appServerVersion":"0.147.0"}\\n');
} else if (args[0] === "app-server" && args[1] === "daemon" && args[2] === "start") {
  process.stdout.write("started\\n");
} else if (args[0] === "exec") {
  const marker = args.indexOf("--output-last-message");
  if (marker < 0 || args[marker + 1] === undefined) process.exit(2);
  const schemaMarker = args.indexOf("--output-schema");
  if (schemaMarker < 0 || args[schemaMarker + 1] === undefined) process.exit(2);
  const schema = JSON.parse(await readFile(args[schemaMarker + 1], "utf8"));
  if (schema.properties?.classification !== undefined) {
    let prompt = "";
    for await (const chunk of process.stdin) prompt += chunk;
    const payload = JSON.parse(prompt.slice(prompt.lastIndexOf("\\n") + 1));
    const facts = [];
    for (const page of payload.pages) {
      const lines = page.text.replaceAll("\\r\\n", "\\n").split("\\n");
      for (let index = 0; index <= lines.length - 8; index += 1) {
        const block = lines.slice(index, index + 8);
        if (!block[0].startsWith("FACT|") || block[7] !== "END") continue;
        const value = (position, prefix) => block[position].slice(prefix.length);
        const factKey = value(0, "FACT|");
        const sourceUnit = value(3, "UNIT|");
        facts.push({
          factKey,
          sourceName: value(1, "NAME|"),
          sourceValue: value(2, "VALUE|"),
          sourceUnit,
          proposedCanonicalCode: factKey,
          proposedNormalizedValue: null,
          proposedNormalizedUnit: null,
          proposedSampledAt: null,
          proposedResultedAt: null,
          proposedSpecimenType: null,
          proposedLaboratory: null,
          referenceRange: {
            sourceText: value(4, "RANGE|"),
            sourceLow: null,
            sourceHigh: null,
            sourceUnit,
            laboratoryOutOfRange: null
          },
          confidence: Number(value(5, "CONFIDENCE|")),
          validationIssues: value(6, "ISSUES|") === "NONE" ? [] : value(6, "ISSUES|").split(","),
          source: { pageNumber: page.pageNumber, fragment: block.join("\\n") }
        });
      }
    }
    const structuredResults = facts.map((fact, index) => ({
      resultKey: fact.factKey,
      type: "measurement",
      label: "Синтетический результат " + (index + 1),
      value: fact.sourceValue,
      unit: fact.sourceUnit,
      code: fact.proposedCanonicalCode,
      lab: "Синтетическая лаборатория",
      specimen: "Синтетическая кровь",
      date: "2026-08-10",
      status: "unknown",
      confidence: fact.confidence,
      source: fact.source
    }));
    await writeFile(args[marker + 1], JSON.stringify({
      classification: {
        category: facts.length > 0 ? "laboratory" : "other",
        title: facts.length > 0 ? "Синтетические лабораторные результаты" : "Синтетический документ",
        shortSummary: facts.length > 0
          ? "Документ содержит " + facts.length + " синтетических лабораторных значений."
          : "Документ не содержит поддерживаемых синтетических результатов.",
        detailedSummary: facts.length > 0
          ? "Codex структурировал явные синтетические значения и сохранил точные фрагменты источника."
          : "Codex классифицировал синтетический документ без количественных лабораторных значений.",
        documentDate: null,
        sampledAt: facts.length > 0 ? "2026-08-10T08:00:00.000Z" : null,
        resultedAt: facts.length > 0 ? "2026-08-10T12:00:00.000Z" : null,
        specimenType: facts.length > 0 ? "Синтетическая кровь" : null,
        laboratory: facts.length > 0 ? "Синтетическая лаборатория" : null,
        confidence: 0.94
      },
      structuredResults,
      facts
    }));
  } else {
    await writeFile(args[marker + 1], JSON.stringify({ items: [
      { category: "laboratory", sourceObservationIndex: 0, missingContext: ["sample_date"] },
      { category: "nutrition", sourceObservationIndex: null, missingContext: ["dietary_restrictions"] }
    ] }));
  }
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
  await run(["exec", "playwright", "test", ...process.argv.slice(2)]);
} finally {
  await Promise.all([
    rm(testRoot, { force: true, recursive: true }),
    rm(isolatedNextDirectory, { force: true, recursive: true }),
  ]);
}
