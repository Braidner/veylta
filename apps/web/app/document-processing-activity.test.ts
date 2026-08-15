import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_PROCESSING_EVENT_CODES, PROCESSING_REJECTION_REASONS } from "@veylta/contracts";
import {
  failureCodeCopy,
  processingActivityCopy,
  rejectionReasonCopy,
  stageCopy,
} from "./document-processing-activity.js";

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

test("every rejection reason has Russian copy that names the broken rule", () => {
  for (const reason of PROCESSING_REJECTION_REASONS) {
    const copy = rejectionReasonCopy(reason);
    assert.notEqual(copy, reason, `${reason} has no Russian copy`);
    assert.ok(/[А-Яа-яЁё]/.test(copy), `${reason} copy must be Russian`);
  }
  assert.equal(
    rejectionReasonCopy("fragment_not_on_page"),
    "Процитированный фрагмент не найден на указанной странице",
  );
});

test("an unmapped failure code stays visible instead of vanishing", () => {
  assert.equal(failureCodeCopy("AGENT_OUTPUT_INVALID"), "Ответ Codex не прошёл проверку");
  assert.equal(failureCodeCopy("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(stageCopy("structured_extraction"), "структурированный разбор");
});
