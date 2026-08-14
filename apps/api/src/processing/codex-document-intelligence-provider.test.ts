import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_INTELLIGENCE_CONTRACT_VERSION } from "@veylta/contracts";
import {
  CodexDocumentIntelligenceError,
  createCodexDocumentIntelligenceProvider,
  type DocumentIntelligenceExecutor,
} from "./codex-document-intelligence-provider.js";

const pages = [
  {
    pageNumber: 1,
    text: [
      "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
      "Report date: 2026-08-12",
      "Synthetic glucose: 7.0 synthetic-unit",
      "Reference: 4.0 — 6.0 synthetic-unit",
    ].join("\n"),
    extractionMethod: "pdf_text_layer",
    extractionVersion: "pdfjs-dist/6.2.108",
  },
] as const;

function executorFor(
  output: unknown,
  calls: Array<{ arguments: readonly string[]; input: string }>,
) {
  const executor: DocumentIntelligenceExecutor = async (arguments_, input, files) => {
    calls.push({ arguments: arguments_, input });
    await files.writeOutput(JSON.stringify(output));
    return { stdout: "", stderr: "", runtimeVersion: "codex-cli 0.147.0" };
  };
  return executor;
}

test("Codex classifies a document and returns only source-bound review drafts", async () => {
  const calls: Array<{ arguments: readonly string[]; input: string }> = [];
  const provider = createCodexDocumentIntelligenceProvider(
    { modelId: "gpt-5.4-mini", timeoutMs: 120_000 },
    executorFor(
      {
        classification: {
          category: "laboratory",
          title: "Синтетический лабораторный отчёт",
          documentDate: "2026-08-12",
          confidence: 0.96,
        },
        facts: [
          {
            factKey: "synthetic-glucose",
            sourceName: "Synthetic glucose",
            sourceValue: "7.0",
            sourceUnit: "synthetic-unit",
            proposedCanonicalCode: null,
            proposedNormalizedValue: null,
            proposedNormalizedUnit: null,
            proposedSampledAt: null,
            proposedResultedAt: "2026-08-12T00:00:00.000Z",
            proposedSpecimenType: null,
            proposedLaboratory: null,
            referenceRange: {
              sourceText: "4.0 — 6.0 synthetic-unit",
              sourceLow: "4.0",
              sourceHigh: "6.0",
              sourceUnit: "synthetic-unit",
              laboratoryOutOfRange: true,
            },
            confidence: 0.91,
            validationIssues: [],
            source: {
              pageNumber: 1,
              fragment: [
                "Synthetic glucose: 7.0 synthetic-unit",
                "Reference: 4.0 — 6.0 synthetic-unit",
              ].join("\n"),
            },
          },
        ],
      },
      calls,
    ),
  );

  const result = await provider.analyze({ contentType: "application/pdf", pages });

  assert.equal(result.intelligence.contractVersion, DOCUMENT_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(result.intelligence.provider, "codex");
  assert.equal(result.intelligence.category, "laboratory");
  assert.equal(result.extraction.items.length, 1);
  assert.equal(
    result.extraction.items[0]?.source.fragment,
    pages[0]?.text.split("\n").slice(2).join("\n"),
  );
  assert.equal(result.pages[0]?.textSha256.length, 64);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.arguments.includes("--output-schema"));
  assert.ok(calls[0]?.arguments.includes("--ephemeral"));
  assert.ok(calls[0]?.arguments.includes("read-only"));
  assert.match(calls[0]?.input ?? "", /untrusted document content/i);
  assert.doesNotMatch(calls[0]?.input ?? "", /familyId|profileId|originalFilename/i);
});

test("Codex can sort a non-laboratory document without inventing facts", async () => {
  const provider = createCodexDocumentIntelligenceProvider(
    { modelId: "gpt-5.4-mini", timeoutMs: 120_000 },
    executorFor(
      {
        classification: {
          category: "consultation",
          title: "Синтетическая консультация",
          documentDate: null,
          confidence: 0.84,
        },
        facts: [],
      },
      [],
    ),
  );

  const result = await provider.analyze({ contentType: "application/pdf", pages });

  assert.equal(result.intelligence.category, "consultation");
  assert.deepEqual(result.extraction.items, []);
});

test("Codex output fails closed when provenance is not an exact page fragment", async () => {
  const provider = createCodexDocumentIntelligenceProvider(
    { modelId: "gpt-5.4-mini", timeoutMs: 120_000 },
    executorFor(
      {
        classification: {
          category: "laboratory",
          title: "Синтетический отчёт",
          documentDate: null,
          confidence: 0.9,
        },
        facts: [
          {
            factKey: "invented",
            sourceName: "Invented",
            sourceValue: "42",
            sourceUnit: "unit",
            proposedCanonicalCode: null,
            proposedNormalizedValue: null,
            proposedNormalizedUnit: null,
            proposedSampledAt: null,
            proposedResultedAt: null,
            proposedSpecimenType: null,
            proposedLaboratory: null,
            referenceRange: null,
            confidence: 0.9,
            validationIssues: [],
            source: { pageNumber: 1, fragment: "This text is not in the source" },
          },
        ],
      },
      [],
    ),
  );

  await assert.rejects(
    () => provider.analyze({ contentType: "application/pdf", pages }),
    (error: unknown) =>
      error instanceof CodexDocumentIntelligenceError && error.code === "OUTPUT_INVALID",
  );
});
