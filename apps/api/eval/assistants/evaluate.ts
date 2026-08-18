// The judge: what a turn's outcome must satisfy for one vignette. Plumbing (a verified answer or
// an expected refusal came back at all) is separate from the clinical expectations, so the fake
// codex can prove the harness while only the real model is held to the vignette's medicine.
import type { AssistantBlock } from "@veylta/contracts";
import type { AssistantTurnOutcome } from "../../src/assistant/assistant-turn.js";
import { tierRank, type Vignette } from "./vignette.js";

export interface Check {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VignetteResult {
  readonly id: string;
  readonly title: string;
  readonly plumbing: Check;
  readonly clinical: readonly Check[];
  readonly durationMs: number;
}

/** Every human-readable string of a block, for the forbidden-phrase sweep. */
function textsOf(block: AssistantBlock): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(block)) {
    if (key === "kind" || key === "refs") continue;
    if (typeof value === "string") values.push(value);
    if (Array.isArray(value))
      for (const item of value) if (typeof item === "string") values.push(item);
  }
  return values;
}

function namesOf(block: AssistantBlock): string[] {
  switch (block.kind) {
    case "hypothesis":
    case "treatment_option":
    case "diet_recommendation":
    case "activity_recommendation":
      return [block.name, block.rationale];
    case "interpretation":
    case "diet_assessment":
    case "activity_assessment":
      return [block.text];
    default:
      return [];
  }
}

export function evaluateVignette(
  vignette: Vignette,
  outcome: AssistantTurnOutcome,
  durationMs: number,
): VignetteResult {
  const base = { id: vignette.id, title: vignette.title, durationMs };
  if (outcome.answer === null) {
    return {
      ...base,
      plumbing: {
        name: "answer",
        passed: false,
        detail: `refused: ${outcome.refusal ?? "unknown"}`,
      },
      clinical: [],
    };
  }
  const answer = outcome.answer;
  const plumbing: Check = {
    name: "answer",
    passed: answer.blocks.length > 0,
    detail: `${answer.blocks.length} blocks, urgency ${answer.urgency.tier}, ${outcome.exchanges.length} exchanges`,
  };
  const expect = vignette.expect;
  const clinical: Check[] = [];
  const tier = answer.urgency.tier;
  clinical.push({
    name: "urgency ≥ minimum",
    passed: tierRank(tier) >= tierRank(expect.minUrgency),
    detail: `${tier} vs ≥ ${expect.minUrgency}`,
  });
  if (expect.maxUrgency !== undefined) {
    clinical.push({
      name: "urgency ≤ maximum",
      passed: tierRank(tier) <= tierRank(expect.maxUrgency),
      detail: `${tier} vs ≤ ${expect.maxUrgency}`,
    });
  }
  const names = answer.blocks.flatMap(namesOf);
  for (const pattern of expect.names ?? []) {
    clinical.push({
      name: `names ${pattern}`,
      passed: names.some((name) => pattern.test(name)),
      detail: names.length === 0 ? "no named blocks" : names.slice(0, 4).join(" | "),
    });
  }
  if (expect.specialties !== undefined) {
    const named = new Set(
      answer.blocks.flatMap((block) => ("confirmWith" in block ? [block.confirmWith] : [])),
    );
    clinical.push({
      name: `refers to ${expect.specialties.join("/")}`,
      passed: expect.specialties.some((specialty) => named.has(specialty)),
      detail: [...named].join(", ") || "no referral",
    });
  }
  for (const kind of expect.kinds ?? []) {
    clinical.push({
      name: `has ${kind}`,
      passed: answer.blocks.some((block) => block.kind === kind),
      detail: answer.blocks.map((block) => block.kind).join(", "),
    });
  }
  const texts = answer.blocks.flatMap(textsOf);
  for (const pattern of expect.forbid ?? []) {
    const hit = texts.find((text) => pattern.test(text));
    clinical.push({
      name: `never ${pattern}`,
      passed: hit === undefined,
      detail: hit === undefined ? "clean" : hit.slice(0, 120),
    });
  }
  for (const context of expect.missing ?? []) {
    clinical.push({
      name: `asks for ${context}`,
      passed: answer.blocks.some((block) => block.kind === "missing" && block.context === context),
      detail:
        answer.blocks
          .flatMap((block) => (block.kind === "missing" ? [block.context] : []))
          .join(", ") || "asks for nothing",
    });
  }
  return { ...base, plumbing, clinical };
}

/** The Markdown report: one table row per vignette, then the failures spelled out. */
export function renderReport(
  results: readonly VignetteResult[],
  input: { readonly mode: "fake" | "codex"; readonly modelId: string; readonly startedAt: string },
): string {
  const rows = results.map((result) => {
    const failed = result.clinical.filter((check) => !check.passed).length;
    const clinical = input.mode === "fake" ? "n/a" : failed === 0 ? "pass" : `${failed} failed`;
    return `| ${result.id} | ${result.title} | ${result.plumbing.passed ? "ok" : "FAIL"} | ${clinical} | ${Math.round(result.durationMs / 1000)} s |`;
  });
  const plumbingFailures = results.filter((result) => !result.plumbing.passed);
  const clinicalFailures =
    input.mode === "fake"
      ? []
      : results.filter((result) => result.clinical.some((check) => !check.passed));
  const lines = [
    `# Assistant eval — ${input.mode === "fake" ? "fake codex (plumbing only)" : `Codex ${input.modelId}`}`,
    "",
    `Run at ${input.startedAt}. ${results.length} synthetic vignettes; ${plumbingFailures.length} plumbing failures; ${
      input.mode === "fake"
        ? "clinical expectations not judged"
        : `${clinicalFailures.length} with clinical failures`
    }.`,
    "",
    "| id | vignette | answer | clinical | took |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ];
  for (const result of [...plumbingFailures, ...clinicalFailures]) {
    lines.push("", `## ${result.id} — ${result.title}`, "");
    if (!result.plumbing.passed) lines.push(`- plumbing: ${result.plumbing.detail}`);
    for (const check of result.clinical.filter((check) => !check.passed)) {
      lines.push(`- ${check.name}: ${check.detail}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
