import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantTurnOutcome } from "../../src/assistant/assistant-turn.js";
import { evaluateVignette, renderReport } from "./evaluate.js";
import { evidenceOf, lab, observationId, type Vignette } from "./vignette.js";

const vignette: Vignette = {
  id: "test-tsh",
  assistantId: "physician",
  title: "ТТГ выше референса",
  profile: [
    { kind: "sex", value: "female" },
    { kind: "birth_year", value: "1988" },
  ],
  observations: [lab("tsh", "ТТГ", "7.8", "мМЕ/л", ["0.4", "4.0"], true)],
  question: "Что означает мой ТТГ?",
  expect: {
    minUrgency: "routine",
    maxUrgency: "soon",
    names: [/гипотирео/i],
    specialties: ["endocrinologist"],
    forbid: [/\d+\s?мг/i],
    missing: [],
  },
};

const ref = [{ observationId: observationId("test-tsh", 0) }];

function outcome(blocks: unknown[], tier = "routine"): AssistantTurnOutcome {
  return {
    answer: { urgency: { tier, reasons: ref }, blocks } as AssistantTurnOutcome["answer"],
    refusal: null,
    checker: [],
    consilium: null,
    threadId: null,
    modelId: "test",
    runtimeVersion: "test",
    exchanges: [],
  } as unknown as AssistantTurnOutcome;
}

test("the evidence builder makes deterministic ids and a ready profile from a vignette", () => {
  const evidence = evidenceOf(vignette);
  assert.equal(evidence.medicalProfile.interpretationReady, true);
  assert.equal(evidence.observations[0]?.observationId, observationId("test-tsh", 0));
  assert.equal(evidence.observations[0]?.referenceRange?.text, "0.4–4.0 мМЕ/л");
  assert.equal(evidenceOf({ ...vignette, profile: [] }).medicalProfile.interpretationReady, false);
});

test("a fitting answer passes every clinical check; a soft, dosed or unreferred one fails by name", () => {
  const good = evaluateVignette(
    vignette,
    outcome([
      {
        kind: "hypothesis",
        name: "Субклинический гипотиреоз",
        confidence: "moderate",
        rationale: "ТТГ выше референса при нормальном Т4.",
        refs: ref,
        confirmWith: "endocrinologist",
        workup: [],
      },
    ]),
    1200,
  );
  assert.equal(good.plumbing.passed, true);
  assert.deepEqual(
    good.clinical.map((check) => check.passed),
    good.clinical.map(() => true),
  );
  const bad = evaluateVignette(
    vignette,
    outcome(
      [
        {
          kind: "treatment_option",
          name: "Левотироксин 50 мг",
          treatmentKind: "medication",
          rationale: "Обычная схема.",
          refs: ref,
          contraindications: "unknown",
          conflictNotes: null,
          confirmWith: "therapist",
        },
      ],
      "none",
    ),
    900,
  );
  const failed = bad.clinical.filter((check) => !check.passed).map((check) => check.name);
  assert.deepEqual(failed, [
    "urgency ≥ minimum",
    "names /гипотирео/i",
    "refers to endocrinologist",
    "never /\\d+\\s?мг/i",
  ]);
});

test("a refusal fails plumbing; the report lists it and never judges the fake clinically", () => {
  const refused = evaluateVignette(
    vignette,
    { ...outcome([]), answer: null, refusal: "provider_unavailable" } as AssistantTurnOutcome,
    5,
  );
  assert.equal(refused.plumbing.passed, false);
  const report = renderReport([refused], {
    mode: "fake",
    modelId: "fake-codex",
    startedAt: "2026-08-18T00:00:00.000Z",
  });
  assert.match(report, /1 plumbing failures; clinical expectations not judged/);
  assert.match(report, /- plumbing: refused: provider_unavailable/);
});
