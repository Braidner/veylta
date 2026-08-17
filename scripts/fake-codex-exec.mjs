// The `exec` half of the fake codex (scripts/fake-codex.mjs): one branch per output schema
// Veylta asks for — laboratory extraction, the physician answer, the checker verdicts, care-plan
// proposals — each answered with fixed synthetic content bound to what the prompt carried.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { assistantOutput } from "./fake-codex-assistant.mjs";

// «5.0–8.0 synthetic-unit» → printed bounds, as the API-side twin reads them; other text stays text.
const printedBoundsPattern = /^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)(?:\s+\S.*)?$/;
function printedBounds(referenceText) {
  const match = printedBoundsPattern.exec(referenceText.trim());
  return match === null
    ? { sourceLow: null, sourceHigh: null }
    : { sourceLow: match[1], sourceHigh: match[2] };
}

export async function handleExec(args) {
  const marker = args.indexOf("--output-last-message");
  if (marker < 0 || args[marker + 1] === undefined) process.exit(2);
  const schemaMarker = args.indexOf("--output-schema");
  if (schemaMarker < 0 || args[schemaMarker + 1] === undefined) process.exit(2);
  const schema = JSON.parse(await readFile(args[schemaMarker + 1], "utf8"));
  if (schema.properties?.classification !== undefined) {
    let prompt = "";
    for await (const chunk of process.stdin) prompt += chunk;
    const payload = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
    // Attached page images: the stub cannot read pixels, so it "transcribes" one fixed
    // synthetic report per attached page, exactly as the API-side test double does.
    const attached = args.reduce((count, arg) => count + (arg === "--image" ? 1 : 0), 0);
    const transcription = [
      "VEYLTA SYNTHETIC LAB REPORT v1",
      "SYNTHETIC TEST DATA \u2014 NOT FOR MEDICAL USE",
      "FACT|synthetic-analyte-a",
      "NAME|SYNTHETIC ANALYTE A",
      "VALUE|7.0",
      "UNIT|synthetic-unit",
      "RANGE|synthetic reference",
      "CONFIDENCE|0.60",
      "ISSUES|AMBIGUOUS_UNIT",
      "END",
    ].join("\n");
    const pages =
      attached > 0
        ? Array.from({ length: attached }, (_, index) => ({
            pageNumber: index + 1,
            text: transcription,
          }))
        : payload.pages;
    const facts = [];
    for (const page of pages) {
      const lines = page.text.replaceAll("\r\n", "\n").split("\n");
      for (let index = 0; index <= lines.length - 8; index += 1) {
        const block = lines.slice(index, index + 8);
        if (!block[0].startsWith("FACT|") || block[7] !== "END") continue;
        const value = (position, prefix) => block[position].slice(prefix.length);
        const factKey = value(0, "FACT|");
        const sourceUnit = value(3, "UNIT|");
        facts.push({
          factKey,
          sourceName: value(1, "NAME|"),
          sourceValue: value(2, "VALUE|"),
          sourceUnit,
          proposedCanonicalCode: factKey,
          proposedNormalizedValue: null,
          proposedNormalizedUnit: null,
          proposedSampledAt: null,
          proposedResultedAt: null,
          proposedSpecimenType: null,
          proposedLaboratory: null,
          referenceRange: {
            sourceText: value(4, "RANGE|"),
            ...printedBounds(value(4, "RANGE|")),
            sourceUnit,
            laboratoryOutOfRange: null,
          },
          confidence: Number(value(5, "CONFIDENCE|")),
          validationIssues: value(6, "ISSUES|") === "NONE" ? [] : value(6, "ISSUES|").split(","),
          source: { pageNumber: page.pageNumber, fragment: block.join("\n") },
        });
      }
    }
    const structuredResults = facts.map((fact, index) => ({
      resultKey: fact.factKey,
      type: "measurement",
      label: "Синтетический результат " + (index + 1),
      value: fact.sourceValue,
      unit: fact.sourceUnit,
      code: fact.proposedCanonicalCode,
      lab: "Синтетическая лаборатория",
      specimen: "Синтетическая кровь",
      date: "2026-08-10",
      status: "unknown",
      confidence: fact.confidence,
      source: fact.source,
    }));
    await writeFile(
      args[marker + 1],
      JSON.stringify({
        ...(attached > 0
          ? { pages: pages.map(({ pageNumber, text }) => ({ pageNumber, text })) }
          : {}),
        classification: {
          category: facts.length > 0 ? "laboratory" : "other",
          title:
            facts.length > 0 ? "Синтетические лабораторные результаты" : "Синтетический документ",
          shortSummary:
            facts.length > 0
              ? "Документ содержит " + facts.length + " синтетических лабораторных значений."
              : "Документ не содержит поддерживаемых синтетических результатов.",
          detailedSummary:
            facts.length > 0
              ? "Codex структурировал явные синтетические значения и сохранил точные фрагменты источника."
              : "Codex классифицировал синтетический документ без количественных лабораторных значений.",
          documentDate: null,
          sampledAt: facts.length > 0 ? "2026-08-10T08:00:00.000Z" : null,
          resultedAt: facts.length > 0 ? "2026-08-10T12:00:00.000Z" : null,
          specimenType: facts.length > 0 ? "Синтетическая кровь" : null,
          laboratory: facts.length > 0 ? "Синтетическая лаборатория" : null,
          confidence: 0.94,
        },
        structuredResults,
        facts,
      }),
    );
  } else if (schema.properties?.blocks !== undefined || schema.properties?.verdicts !== undefined) {
    let prompt = "";
    for await (const chunk of process.stdin) prompt += chunk;
    process.stdout.write(
      `${JSON.stringify({
        type: "thread.started",
        thread_id: args[1] === "resume" ? args[args.length - 2] : randomUUID(),
      })}\n`,
    );
    await writeFile(args[marker + 1], JSON.stringify(assistantOutput(schema, args, prompt)));
  } else {
    await writeFile(
      args[marker + 1],
      JSON.stringify({
        items: [
          { category: "laboratory", sourceObservationIndex: 0, missingContext: ["sample_date"] },
          {
            category: "nutrition",
            sourceObservationIndex: null,
            missingContext: ["dietary_restrictions"],
          },
        ],
      }),
    );
  }
}
