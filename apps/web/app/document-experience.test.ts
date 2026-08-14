import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentSummary } from "@veylta/contracts";
import {
  buildDocumentSearchPath,
  documentResultStatusCopy,
  documentResultTypeCopy,
  normalizeDocumentSearchResponse,
} from "./components/veylta-app";

const document = {
  id: "00000000-0000-4000-8000-000000000003",
  familyId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000002",
  status: "uploaded",
  originalFilename: "synthetic-study.pdf",
  contentType: "application/pdf",
  byteSize: 1_024,
  sha256: "a".repeat(64),
  uploadedAt: "2026-08-14T12:16:00.000Z",
  duplicate: { possible: false, documentId: null, profileId: null },
  intelligence: null,
  processing: { state: "completed", updatedAt: "2026-08-14T12:17:00.000Z", factCount: 3 },
} satisfies DocumentSummary;

test("document search path safely preserves a Russian query", () => {
  assert.equal(
    buildDocumentSearchPath("family/id", "profile id", "  гемохроматоз HFE  "),
    "/v1/families/family%2Fid/profiles/profile%20id/documents?q=%D0%B3%D0%B5%D0%BC%D0%BE%D1%85%D1%80%D0%BE%D0%BC%D0%B0%D1%82%D0%BE%D0%B7+HFE",
  );
});

test("search response accepts both final object shape and a narrow array fallback", () => {
  assert.deepEqual(normalizeDocumentSearchResponse({ documents: [document] }), [document]);
  assert.deepEqual(normalizeDocumentSearchResponse([document]), [document]);
  assert.deepEqual(normalizeDocumentSearchResponse({ items: [document] }), [document]);
  assert.deepEqual(normalizeDocumentSearchResponse({ documents: "invalid" }), []);
});

test("structured result status is written in Russian and stays clinically neutral", () => {
  assert.equal(documentResultStatusCopy("not_detected"), "Не обнаружено");
  assert.equal(documentResultStatusCopy("completed"), "Выполнено");
  assert.equal(documentResultStatusCopy("abnormal"), "Отмечено источником");
  assert.equal(documentResultStatusCopy("unknown"), "Без оценки");
});

test("result types are presented as neutral Russian source categories", () => {
  assert.equal(documentResultTypeCopy("measurement"), "Измерение");
  assert.equal(documentResultTypeCopy("genetic_variant"), "Генетический вариант");
  assert.equal(documentResultTypeCopy("finding"), "Наблюдение");
  assert.equal(documentResultTypeCopy("other"), "Результат");
});
