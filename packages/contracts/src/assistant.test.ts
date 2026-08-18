import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSISTANT_ACTIVITY_KINDS,
  ASSISTANT_CLEARANCE_STATES,
  ASSISTANT_CONTRACT_VERSION,
  ASSISTANT_DIET_CATEGORIES,
  ASSISTANT_IDS,
  ASSISTANT_MISSING_CONTEXTS,
  type AssistantBlock,
} from "./index.js";

test("the assistants are a closed set of rooms with closed vocabularies for their blocks", () => {
  assert.equal(ASSISTANT_CONTRACT_VERSION, "assistant/v6");
  assert.deepEqual(ASSISTANT_IDS, ["physician", "nutritionist", "trainer"]);
  assert.deepEqual(ASSISTANT_DIET_CATEGORIES, [
    "structure",
    "favour",
    "limit",
    "supplement",
    "hydration",
    "timing",
  ]);
  assert.deepEqual(ASSISTANT_ACTIVITY_KINDS, [
    "aerobic",
    "strength",
    "mobility",
    "recovery",
    "avoid",
  ]);
  assert.deepEqual(ASSISTANT_CLEARANCE_STATES, ["within", "needs_clearance", "unknown"]);
  for (const context of [
    "height_weight",
    "dietary_restrictions",
    "goals",
    "clearance",
    "activity_constraints",
  ]) {
    assert.ok(
      ASSISTANT_MISSING_CONTEXTS.includes(context as (typeof ASSISTANT_MISSING_CONTEXTS)[number]),
    );
  }
});

test("an activity recommendation carries its load and progression as phrases and a clearance state", () => {
  const block = {
    kind: "activity_recommendation",
    name: "Быстрая ходьба",
    activityKind: "aerobic",
    load: "3 раза в неделю по 30 минут в разговорном темпе",
    progression: "через 4 недели добавить 5–10 минут к каждой прогулке",
    rationale: "Умеренная аэробная нагрузка при таких значениях обычно безопасна.",
    refs: [{ observationId: "00000000-0000-4000-8000-00000000000a" }],
    clearance: "within",
    conflictNotes: null,
    confirmWith: "physiotherapist",
  } as const satisfies AssistantBlock;
  assert.equal(block.clearance, "within");
  assert.equal(block.progression?.startsWith("через"), true);
});
