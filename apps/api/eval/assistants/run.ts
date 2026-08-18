// `pnpm eval:assistants` — the vignette harness. Runs every synthetic vignette through the same
// turn the API runs (persona prompt, closed schema, parser, checker) against the local Codex CLI,
// or with `--fake` against the scripted runtime the tests use (plumbing only), and writes a
// Markdown report. Only synthetic evidence ever leaves; the report holds nothing but it.
//
//   pnpm eval:assistants                 real model, all vignettes, report to .local/eval/
//   pnpm eval:assistants --only phy-01   one vignette
//   pnpm eval:assistants --fake          scripted runtime, no model, exits non-zero on plumbing only
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAssistantTurn } from "../../src/assistant/assistant-turn.js";
import {
  type AssistantRuntime,
  createCodexAssistantRuntime,
} from "../../src/assistant/codex-assistant-runtime.js";
import { codexDefaultPreference } from "../../src/codex/codex-defaults.js";
import { scriptedOutput } from "../../test/assistant-scripts.js";
import { evaluateVignette, renderReport, type VignetteResult } from "./evaluate.js";
import { evidenceOf } from "./vignette.js";
import { vignettes } from "./vignettes.js";

/** Paths resolve from the repository root; the default sits under its ignored `.local/`. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultReport = ".local/eval/assistants-latest.md";

interface Options {
  readonly fake: boolean;
  readonly only: string | null;
  readonly out: string;
}

function options(argv: readonly string[]): Options {
  const only = argv.indexOf("--only");
  const out = argv.indexOf("--out");
  return {
    fake: argv.includes("--fake"),
    only: only === -1 ? null : (argv[only + 1] ?? null),
    out: out === -1 ? defaultReport : (argv[out + 1] ?? defaultReport),
  };
}

/** The scripted runtime the integration tests use: the same shapes as the e2e fake codex. */
function fakeRuntime(): AssistantRuntime {
  return {
    async run(turn) {
      return {
        threadId: turn.threadId ?? "eval-thread",
        output: JSON.stringify(
          scriptedOutput(turn.schema as Parameters<typeof scriptedOutput>[0], turn.prompt),
        ),
        modelId: "fake-codex",
        runtimeVersion: "fake",
        durationMs: 1,
      };
    },
  };
}

async function main(): Promise<number> {
  const opts = options(process.argv.slice(2));
  const preference = codexDefaultPreference();
  const runtime = opts.fake
    ? fakeRuntime()
    : createCodexAssistantRuntime({
        resolveExecutionProfile: async () => preference,
        timeoutMs: 10 * 60 * 1_000,
      });
  const selected = vignettes.filter(
    (vignette) => opts.only === null || vignette.id.startsWith(opts.only),
  );
  if (selected.length === 0) {
    process.stderr.write(`No vignette matches ${opts.only ?? "(none)"}\n`);
    return 2;
  }
  const startedAt = new Date().toISOString();
  const results: VignetteResult[] = [];
  for (const vignette of selected) {
    const started = Date.now();
    const outcome = await runAssistantTurn(runtime, vignette.assistantId, {
      threadId: null,
      evidence: evidenceOf(vignette),
      evidenceChanged: true,
      message: vignette.question,
    });
    const result = evaluateVignette(vignette, outcome, Date.now() - started);
    results.push(result);
    const failed = result.clinical.filter((check) => !check.passed).length;
    process.stdout.write(
      `${result.plumbing.passed ? "ok  " : "FAIL"} ${vignette.id} — ${vignette.title}${
        opts.fake ? "" : failed === 0 ? " · clinical pass" : ` · ${failed} clinical failure(s)`
      }\n`,
    );
  }
  const report = renderReport(results, {
    mode: opts.fake ? "fake" : "codex",
    modelId: opts.fake ? "fake-codex" : preference.modelId,
    startedAt,
  });
  const path = resolve(repositoryRoot, opts.out);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, report, "utf8");
  process.stdout.write(`\nReport: ${path}\n`);
  const plumbingFailures = results.filter((result) => !result.plumbing.passed).length;
  const clinicalFailures = opts.fake
    ? 0
    : results.filter((result) => result.clinical.some((check) => !check.passed)).length;
  return plumbingFailures + clinicalFailures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
