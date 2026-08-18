import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANT_OUTCOME_VERDICTS } from "@veylta/contracts";
import {
  checkCountsCopy,
  outcomeCountsCopy,
  outcomeLine,
  outcomesEmpty,
  outcomeVerdictCopy,
  takesOutcome,
} from "./assistant-outcomes";

const records = new Map([
  [
    "00000000-0000-4000-8000-0000000000aa",
    {
      recordId: "00000000-0000-4000-8000-0000000000aa",
      kind: "diagnosis",
      label: "Синтетический субклинический гипотиреоз",
      detail: null,
      documentDate: "2026-08-01",
      documentId: "00000000-0000-4000-8000-0000000000d0",
      pageNumber: 1,
    },
  ],
]);

test("the clinician's word reads as one line: verdict, date, note, the record it rests on", () => {
  for (const verdict of ASSISTANT_OUTCOME_VERDICTS) {
    assert.match(outcomeVerdictCopy[verdict].said, /^Врач /);
  }
  assert.equal(
    outcomeLine(
      {
        blockIndex: 1,
        verdict: "modified",
        decidedOn: "2026-08-10",
        note: "Назвал другое состояние.",
        recordId: "00000000-0000-4000-8000-0000000000aa",
        recordedAt: "2026-08-11T10:00:00.000Z",
      },
      records,
    ),
    "Врач изменил · 10 августа 2026 г. · Назвал другое состояние. · запись врача: Синтетический субклинический гипотиреоз",
  );
  assert.equal(
    outcomeLine(
      {
        blockIndex: 1,
        verdict: "confirmed",
        decidedOn: null,
        note: null,
        recordId: "00000000-0000-4000-8000-0000000000ff",
        recordedAt: "2026-08-11T10:00:00.000Z",
      },
      records,
    ),
    "Врач подтвердил · запись врача: больше не подтверждена",
  );
});

test("the room's log counts marks and сверка positions in words, and knows when it is empty", () => {
  assert.equal(
    outcomeCountsCopy({ confirmed: 1, rejected: 0, modified: 2 }),
    "подтверждено 1 · изменено 2 · отклонено 0",
  );
  assert.equal(
    checkCountsCopy({ agree: 1, differs: 2, cannot_assess: 0 }),
    "сверка: согласен 1 · расходится 2 · не оценить 0",
  );
  assert.equal(
    outcomesEmpty({
      counts: { confirmed: 0, rejected: 0, modified: 0 },
      checks: { agree: 0, differs: 0, cannot_assess: 0 },
      entries: [],
    }),
    true,
  );
  assert.equal(
    outcomesEmpty({
      counts: { confirmed: 0, rejected: 0, modified: 0 },
      checks: { agree: 0, differs: 1, cannot_assess: 0 },
      entries: [],
    }),
    false,
  );
});

test("only the blocks an answer asks to confirm take the clinician's word", () => {
  assert.equal(takesOutcome({ kind: "general", text: "Справка." }), false);
  assert.equal(takesOutcome({ kind: "question", text: "Вопрос?", refs: [] }), false);
  assert.equal(
    takesOutcome({
      kind: "hypothesis",
      name: "A",
      confidence: "low",
      rationale: "r",
      refs: [],
      confirmWith: "therapist",
      workup: [],
    }),
    true,
  );
});
