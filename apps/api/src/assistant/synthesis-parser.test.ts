import assert from "node:assert/strict";
import test from "node:test";
import { AssistantAnswerError } from "./answer-fields.js";
import { parseSynthesis } from "./synthesis-parser.js";

const observationA = "00000000-0000-4000-8000-00000000000a";
const context = {
  knownObservationIds: new Set([observationA]),
  profileValues: new Set(["6.8"]),
  interpretationReady: true,
};

function synthesis(agreements: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    urgency: { tier: "soon", reasons: [{ observationId: observationA }] },
    blocks: [
      {
        kind: "interpretation",
        text: "ТТГ выше напечатанного диапазона.",
        refs: [{ observationId: observationA }],
      },
    ],
    agreements,
    ...extra,
  });
}

test("a synthesis is a verified answer plus agreement notes bound to the invited specialties", () => {
  const parsed = parseSynthesis(
    synthesis([
      {
        topic: "Срочность",
        verdict: "differ",
        specialties: ["endocrinologist", "hematologist"],
        why: "Эндокринолог считает, что визит нужен в ближайшие недели, гематолог — планово.",
      },
      {
        topic: "Природа отклонения",
        verdict: "agree",
        specialties: ["endocrinologist", "cardiologist"],
        why: "Кардиолог не был приглашён и выпадает; эндокринолог остаётся.",
      },
    ]),
    context,
    ["endocrinologist", "hematologist"],
  );
  assert.equal(parsed.answer.urgency.tier, "soon");
  assert.equal(parsed.answer.blocks.length, 1);
  assert.deepEqual(
    parsed.agreements.map((note) => [note.verdict, note.specialties]),
    [
      ["differ", ["endocrinologist", "hematologist"]],
      ["agree", ["endocrinologist"]],
    ],
  );
});

test("a note naming nobody from the консилиум or breaking the shape is dropped, not fatal", () => {
  const parsed = parseSynthesis(
    synthesis([
      { topic: "Что-то", verdict: "agree", specialties: ["cardiologist"], why: "Не приглашён." },
      {
        topic: "Latin only",
        verdict: "agree",
        specialties: ["endocrinologist"],
        why: "no russian",
      },
      { topic: "Кривая форма", verdict: "maybe", specialties: ["endocrinologist"], why: "Нет." },
    ]),
    context,
    ["endocrinologist"],
  );
  assert.deepEqual(parsed.agreements, []);
  assert.equal(parsed.answer.blocks.length, 1);
});

test("the synthesis keeps the physician answer's own rules", () => {
  assert.throws(
    () => parseSynthesis(JSON.stringify({ blocks: [], agreements: [] }), context, []),
    (error: unknown) => error instanceof AssistantAnswerError && error.reason === "missing_urgency",
  );
  assert.throws(
    () => parseSynthesis(synthesis([], { extra: true }), context, []),
    (error: unknown) => error instanceof AssistantAnswerError && error.reason === "schema_shape",
  );
});
