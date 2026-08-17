// The assistant half of the fake codex: the physician answer, a specialist persona's opinion,
// the therapist's консилиум synthesis and the checker verdicts — the same scripted shapes the
// API-side runtime in apps/api/test/assistant-app.ts answers with, so e2e and integration
// exercise the same plumbing. Nothing here reads pixels or reasons; it echoes what the prompt
// carried (observation ids, readiness, the `Specialty:` line) into a fixed synthetic answer.
const tiers = ["none", "routine", "soon", "urgent", "emergency"];

function refsOf(prompt) {
  const ids = [...prompt.matchAll(/"observationId":"([0-9a-f-]{36})"/g)].map((match) => match[1]);
  return ids[0] === undefined ? [] : [{ observationId: ids[0] }];
}

function physicianAnswer(args, prompt) {
  const ref = refsOf(prompt);
  if (prompt.includes('"interpretationReady":true') && ref.length > 0) {
    return {
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
        { kind: "general", text: "Синтетический показатель A отражает синтетический процесс." },
      ],
    };
  }
  if (args[1] === "resume") {
    return {
      urgency: { tier: "none", reasons: [] },
      blocks: [{ kind: "general", text: "В общем случае такой показатель оценивают в динамике." }],
    };
  }
  return {
    urgency: { tier: "none", reasons: [] },
    blocks: [
      { kind: "missing", context: "sex" },
      { kind: "missing", context: "birth_year" },
    ],
  };
}

/** A persona's read: the endocrinologist alarms sooner than everyone else, on purpose. */
function specialistOpinion(specialty, prompt) {
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

/** The therapist's synthesis: the highest urgency among the opinions and one named disagreement. */
function synthesis(prompt) {
  const opinions = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
  const tier = opinions.reduce(
    (best, item) =>
      item.answer !== null && tiers.indexOf(item.answer.urgency.tier) > tiers.indexOf(best)
        ? item.answer.urgency.tier
        : best,
    "none",
  );
  const specialties = opinions.map((item) => item.specialty);
  return {
    urgency: { tier, reasons: refsOf(prompt) },
    blocks: [
      {
        kind: "interpretation",
        text: "Специалисты прочли одни и те же подтверждённые значения; ниже — где они сходятся и расходятся.",
        refs: refsOf(prompt),
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

function checkerVerdicts(prompt) {
  const answer = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
  return {
    verdicts: answer.blocks.map((block, blockIndex) => ({
      blockIndex,
      verdict: block.kind === "hypothesis" ? "overreach" : "supported",
      note: block.kind === "hypothesis" ? "Одного значения мало для уверенности." : null,
    })),
    urgency: "routine",
  };
}

export function assistantOutput(schema, args, prompt) {
  if (schema.properties?.verdicts !== undefined) return checkerVerdicts(prompt);
  if (schema.properties?.agreements !== undefined) return synthesis(prompt);
  const specialty = /^Specialty: (\w+)$/m.exec(prompt)?.[1];
  return specialty === undefined
    ? physicianAnswer(args, prompt)
    : specialistOpinion(specialty, prompt);
}
