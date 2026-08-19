import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentIntelligenceStructuredResult, DocumentSummary } from "@veylta/contracts";
import {
  buildIndicatorHistoryPath,
  documentResultAvailabilityCopy,
  documentResultMatchesFact,
  documentResultMissingFields,
} from "./components/veylta-app";
import {
  documentResultStatusCopy,
  documentResultStatusPriority,
  documentResultTypeCopy,
  prioritizeDocumentResults,
} from "./document-results";
import {
  buildDocumentSearchPath,
  canBulkConfirmFact,
  normalizeDocumentSearchResponse,
} from "./documents-archive";

test("generic measurements reuse their review fact by exact source provenance", () => {
  const fact = {
    factKey: "synthetic-glucose",
    sourceValue: "7.0",
    sourceUnit: "mmol/L",
    source: { pageNumber: 1, fragment: "Глюкоза 7.0 mmol/L\nРеференс 4.0–6.0" },
  };

  assert.equal(
    documentResultMatchesFact(
      {
        resultKey: "synthetic-glucose-result",
        type: "measurement",
        value: "7.0",
        unit: "mmol/L",
        source: { pageNumber: 1, fragment: "Глюкоза 7.0 mmol/L" },
      },
      fact,
    ),
    true,
  );
  assert.equal(
    documentResultMatchesFact(
      {
        resultKey: "synthetic-glucose",
        type: "measurement",
        value: "7.1",
        unit: "mmol/L",
        source: { pageNumber: 1, fragment: "Глюкоза 7.0 mmol/L" },
      },
      fact,
    ),
    false,
  );
});

test("bulk confirmation excludes facts that carry extraction warnings", () => {
  assert.equal(canBulkConfirmFact({ reviewStatus: "extracted", validationIssues: [] }), true);
  assert.equal(
    canBulkConfirmFact({ reviewStatus: "needs_review", validationIssues: ["AMBIGUOUS_UNIT"] }),
    false,
  );
  assert.equal(canBulkConfirmFact({ reviewStatus: "confirmed", validationIssues: [] }), false);
});

test("document summary names the absence of structured results without inventing data", () => {
  assert.equal(documentResultAvailabilityCopy(0, 0), "Структурированных результатов нет");
  assert.equal(documentResultAvailabilityCopy(0, 2), null);
  assert.equal(documentResultAvailabilityCopy(2, 0), null);
});

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
  effectiveDate: { value: "2026-08-14", source: "upload" },
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

test("indicator history is scoped to the canonical code and keeps identifier characters safe", () => {
  assert.equal(
    buildIndicatorHistoryPath("family/id", "profile id", "LOINC/718-7 & trend"),
    "/v1/families/family%2Fid/profiles/profile%20id/observations?canonicalCode=LOINC%2F718-7+%26+trend&limit=5",
  );
});

test("result completeness makes the three critical missing source fields explicit", () => {
  assert.deepEqual(documentResultMissingFields({ code: null, date: null, lab: null }), [
    "Код показателя",
    "Дата биоматериала",
    "Лаборатория",
  ]);
  assert.deepEqual(
    documentResultMissingFields({
      code: "synthetic-analyte-a",
      date: "2026-08-10T08:00:00.000Z",
      lab: null,
    }),
    ["Лаборатория"],
  );
  assert.deepEqual(
    documentResultMissingFields({
      code: "synthetic-analyte-a",
      date: "2026-08-10T08:00:00.000Z",
      lab: "Синтетическая лаборатория",
    }),
    [],
  );
});

test("search response accepts both final object shape and a narrow array fallback", () => {
  assert.deepEqual(normalizeDocumentSearchResponse({ documents: [document] }), [document]);
  assert.deepEqual(normalizeDocumentSearchResponse([document]), [document]);
  assert.deepEqual(normalizeDocumentSearchResponse({ items: [document] }), [document]);
  assert.deepEqual(normalizeDocumentSearchResponse({ documents: "invalid" }), []);
});

test("structured result status is written in Russian and stays clinically neutral", () => {
  assert.equal(documentResultStatusCopy("above_range"), "Выше диапазона");
  assert.equal(documentResultStatusCopy("not_detected"), "Не обнаружено");
  assert.equal(documentResultStatusCopy("completed"), "Выполнено");
  assert.equal(documentResultStatusCopy("abnormal"), "Отмечено источником");
  assert.equal(documentResultStatusCopy("unknown"), "Без оценки");
  assert.equal(documentResultStatusPriority("above_range"), 0);
  assert.equal(documentResultStatusPriority("abnormal"), 1);
  assert.equal(documentResultStatusPriority(null), 1);
});

test("source-marked above-range results are shown first without reordering their peers", () => {
  const result = (
    resultKey: string,
    status: DocumentIntelligenceStructuredResult["status"],
  ): DocumentIntelligenceStructuredResult => ({
    resultKey,
    type: "measurement",
    label: `Результат ${resultKey}`,
    value: "1",
    unit: "ед.",
    code: null,
    lab: null,
    specimen: null,
    date: null,
    status,
    confidence: 1,
    source: { pageNumber: 1, fragment: `RESULT|${resultKey}` },
  });

  assert.deepEqual(
    prioritizeDocumentResults([
      result("normal-first", "normal"),
      result("high-first", "above_range"),
      result("unknown-last", "unknown"),
      result("high-second", "above_range"),
      result("normal-second", "normal"),
    ]).map(({ resultKey }) => resultKey),
    ["high-first", "high-second", "normal-first", "unknown-last", "normal-second"],
  );
});

test("result types are presented as neutral Russian source categories", () => {
  assert.equal(documentResultTypeCopy("measurement"), "Измерение");
  assert.equal(documentResultTypeCopy("genetic_variant"), "Генетический вариант");
  assert.equal(documentResultTypeCopy("finding"), "Наблюдение");
  assert.equal(documentResultTypeCopy("other"), "Результат");
});
