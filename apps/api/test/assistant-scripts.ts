// The scripted answers the API-side assistant runtime gives — the same shapes as the e2e fake in
// scripts/fake-codex-assistant.mjs: cite the ids the prompt carried, interpret only for a ready
// profile, key the persona on the `Specialty:` line and the nutritionist on its schema.

function refsOf(prompt: string) {
  const ids = [...prompt.matchAll(/"observationId":"([0-9a-f-]{36})"/g)].map((match) => match[1]);
  return ids[0] === undefined ? [] : [{ observationId: ids[0] }];
}

function notReady(): unknown {
  return {
    urgency: { tier: "none", reasons: [] },
    blocks: [
      { kind: "missing", context: "sex" },
      { kind: "missing", context: "birth_year" },
    ],
  };
}

/** A persona's scripted read: the endocrinologist alarms sooner than everyone else. */
function specialistOutput(specialty: string, prompt: string): unknown {
  const ref = refsOf(prompt);
  const soon = specialty === "endocrinologist";
  return {
    urgency: { tier: soon ? "soon" : "routine", reasons: ref },
    blocks: [
      {
        kind: "hypothesis",
        name: soon ? "Синтетический субклинический гипотиреоз" : "Синтетическая лёгкая анемия",
        confidence: soon ? "moderate" : "low",
        rationale: "Значение вне напечатанного диапазона; нужна динамика.",
        refs: ref,
        confirmWith: specialty,
        workup: ["Повторить через 6 недель"],
      },
    ],
  };
}

/** The therapist's scripted synthesis: the highest urgency of the opinions and one disagreement. */
function synthesisOutput(prompt: string): unknown {
  const opinions = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as Array<{
    specialty: string;
    answer: { urgency: { tier: string } } | null;
  }>;
  const tiers = ["none", "routine", "soon", "urgent", "emergency"];
  const tier = opinions.reduce(
    (best, item) =>
      item.answer !== null && tiers.indexOf(item.answer.urgency.tier) > tiers.indexOf(best)
        ? item.answer.urgency.tier
        : best,
    "none",
  );
  const ref = refsOf(prompt);
  const specialties = opinions.map((item) => item.specialty);
  return {
    urgency: { tier, reasons: ref },
    blocks: [
      {
        kind: "interpretation",
        text: "Специалисты прочли одни и те же подтверждённые значения; ниже — где они сходятся.",
        refs: ref,
      },
    ],
    agreements:
      specialties.length > 1
        ? [
            {
              topic: "Срочность визита",
              verdict: "differ",
              specialties,
              why: "Один специалист зовёт в ближайшие недели, другой считает визит плановым.",
            },
          ]
        : [],
  };
}

function physicianOutput(prompt: string): unknown {
  const specialty = /^Specialty: (\w+)$/m.exec(prompt)?.[1];
  if (specialty !== undefined) return specialistOutput(specialty, prompt);
  const ref = refsOf(prompt);
  if (!prompt.includes('"interpretationReady":true') || ref.length === 0) return notReady();
  // A confirmed clinician record in the evidence draws a сверка block bound to it.
  const recordId = /"recordId":"([0-9a-f-]{36})"/.exec(prompt)?.[1];
  const checks =
    recordId === undefined
      ? []
      : [
          {
            kind: "clinician_check",
            claim: "differs",
            theirs: { recordId },
            ours: "По подтверждённым значениям картина ближе к норме, чем в записи врача.",
            why: "Значение A в пределах напечатанного диапазона.",
            refs: ref,
            confirmWith: "endocrinologist",
          },
        ];
  return {
    urgency: { tier: "none", reasons: ref },
    blocks: [
      { kind: "interpretation", text: "Значение A в пределах напечатанного диапазона.", refs: ref },
      {
        kind: "hypothesis",
        name: "Синтетическое состояние A",
        confidence: "low",
        rationale: "Одно значение без динамики.",
        refs: ref,
        confirmWith: "therapist",
        workup: ["Повторить A"],
      },
      ...checks,
      { kind: "question", text: "Нужно ли повторять анализ?", refs: ref },
    ],
  };
}

/** The nutritionist's scripted plan: an assessment, a favour, a flagged supplement, a recheck. */
function nutritionistOutput(prompt: string): unknown {
  const ref = refsOf(prompt);
  if (!prompt.includes('"interpretationReady":true') || ref.length === 0) return notReady();
  return {
    urgency: { tier: "routine", reasons: ref },
    blocks: [
      {
        kind: "diet_assessment",
        text: "Синтетический показатель A выше напечатанного диапазона — рацион стоит пересмотреть.",
        refs: ref,
      },
      {
        kind: "diet_recommendation",
        name: "Больше растворимой клетчатки",
        category: "favour",
        rationale: "Овёс, бобовые и овощи обычно помогают при таком значении A.",
        refs: ref,
        interaction: "checked_clear",
        conflictNotes: null,
        confirmWith: "dietitian",
      },
      {
        kind: "diet_recommendation",
        name: "Препараты омега-3",
        category: "supplement",
        rationale: "Класс, который обычно обсуждают при таком значении A; дозу назначает врач.",
        refs: ref,
        interaction: "checked_conflict",
        conflictNotes: "В профиле записано лекарство, с которым это сочетание стоит обсудить.",
        confirmWith: "therapist",
      },
      {
        kind: "recheck",
        text: "Повторить синтетический показатель A после изменения рациона.",
        when: "через 3 месяца",
        refs: ref,
      },
      { kind: "question", text: "Совместимы ли добавки с лекарством из профиля?", refs: ref },
    ],
  };
}

function checkerOutput(prompt: string): unknown {
  const answer = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as { blocks: unknown[] };
  return {
    verdicts: answer.blocks.map((_, blockIndex) => ({
      blockIndex,
      verdict: "supported",
      note: null,
    })),
    urgency: "routine",
  };
}

interface AnswerSchema {
  properties: Record<string, unknown> & {
    blocks?: {
      items?: { anyOf?: readonly { properties: { kind: { enum: readonly string[] } } }[] };
    };
  };
}

/** The nutritionist is told apart by its schema — a follow-up turn carries no preamble. */
export function answersDiet(schema: AnswerSchema): boolean {
  return (schema.properties.blocks?.items?.anyOf ?? []).some(
    (item) => item.properties.kind.enum[0] === "diet_assessment",
  );
}

export function scriptedOutput(schema: AnswerSchema, prompt: string): unknown {
  if (schema.properties.verdicts !== undefined) return checkerOutput(prompt);
  if (schema.properties.agreements !== undefined) return synthesisOutput(prompt);
  if (answersDiet(schema)) return nutritionistOutput(prompt);
  return physicianOutput(prompt);
}
