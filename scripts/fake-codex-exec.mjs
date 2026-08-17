// The `exec` half of the fake codex (scripts/fake-codex.mjs): one branch per output schema
// Veylta asks for — laboratory extraction, the physician answer, the checker verdicts, care-plan
// proposals — each answered with fixed synthetic content bound to what the prompt carried.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

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
            sourceLow: null,
            sourceHigh: null,
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
  } else if (schema.properties?.blocks !== undefined) {
    // The physician assistant: cites the observation ids it was given and interprets only
    // when the profile is ready — the same shape the API-side scripted runtime answers with.
    let prompt = "";
    for await (const chunk of process.stdin) prompt += chunk;
    process.stdout.write(
      JSON.stringify({
        type: "thread.started",
        thread_id: args[1] === "resume" ? args[args.length - 2] : randomUUID(),
      }) + "\n",
    );
    const ids = [...prompt.matchAll(/"observationId":"([0-9a-f-]{36})"/g)].map((match) => match[1]);
    const ref = ids[0] === undefined ? [] : [{ observationId: ids[0] }];
    const ready = prompt.includes('"interpretationReady":true') && ref.length > 0;
    await writeFile(
      args[marker + 1],
      JSON.stringify(
        ready
          ? {
              urgency: { tier: "routine", reasons: ref },
              blocks: [
                {
                  kind: "interpretation",
                  text: "Синтетический показатель A выше напечатанного диапазона.",
                  refs: ref,
                },
                {
                  kind: "hypothesis",
                  name: "Синтетическое состояние A",
                  confidence: "moderate",
                  rationale: "Одно отклонение без динамики; нужно повторить измерение.",
                  refs: ref,
                  confirmWith: "therapist",
                  workup: ["Повторить синтетический показатель A через 4 недели"],
                },
                {
                  kind: "treatment_option",
                  name: "Скорректировать образ жизни",
                  treatmentKind: "lifestyle",
                  rationale: "Общий первый шаг при таком отклонении.",
                  refs: ref,
                  contraindications: "unknown",
                  conflictNotes: null,
                  confirmWith: "therapist",
                },
                { kind: "question", text: "Нужно ли повторить анализ и когда?", refs: ref },
                {
                  kind: "general",
                  text: "Синтетический показатель A отражает синтетический процесс.",
                },
              ],
            }
          : args[1] === "resume"
            ? {
                urgency: { tier: "none", reasons: [] },
                blocks: [
                  {
                    kind: "general",
                    text: "В общем случае такой показатель оценивают в динамике.",
                  },
                ],
              }
            : {
                urgency: { tier: "none", reasons: [] },
                blocks: [
                  { kind: "missing", context: "sex" },
                  { kind: "missing", context: "birth_year" },
                ],
              },
      ),
    );
  } else if (schema.properties?.verdicts !== undefined) {
    let prompt = "";
    for await (const chunk of process.stdin) prompt += chunk;
    process.stdout.write(
      JSON.stringify({ type: "thread.started", thread_id: randomUUID() }) + "\n",
    );
    const answer = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
    await writeFile(
      args[marker + 1],
      JSON.stringify({
        verdicts: answer.blocks.map((block, blockIndex) => ({
          blockIndex,
          verdict: block.kind === "hypothesis" ? "overreach" : "supported",
          note: block.kind === "hypothesis" ? "Одного значения мало для уверенности." : null,
        })),
        urgency: "routine",
      }),
    );
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
