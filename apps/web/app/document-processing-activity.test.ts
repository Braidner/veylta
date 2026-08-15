import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_PROCESSING_EVENT_CODES } from "@veylta/contracts";
import { processingActivityCopy } from "./document-processing-activity.js";

test("every stored event code has journal copy that never leaks a payload", () => {
  const forbidden = /Codex вернул|значение|показател|пациент|файл[а-я]* [«"]/i;

  for (const code of DOCUMENT_PROCESSING_EVENT_CODES) {
    const copy = processingActivityCopy({
      code,
      attempt: 1,
      occurredAt: "2026-08-15T10:00:00.000Z",
    });
    assert.ok(copy.heading.length > 0, `${code} has no heading`);
    assert.ok(copy.detail.length > 0, `${code} has no detail`);
    assert.ok(!forbidden.test(copy.detail), `${code} detail must stay payload-free`);
  }
});

test("terminal failure copy states the outcome without blaming the source", () => {
  assert.deepEqual(
    processingActivityCopy({ code: "failed", attempt: 3, occurredAt: "2026-08-15T10:00:00.000Z" }),
    {
      heading: "Обработка остановлена",
      detail: "Результат не принят. Исходник и предыдущая история сохранены.",
    },
  );
});
