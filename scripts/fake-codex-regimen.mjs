// The regimen rooms of the fake codex: the nutritionist's plan and the trainer's programme — the
// same shapes as apps/api/test/assistant-scripts-regimen.ts, so e2e and integration agree.
import { answerOrMissing } from "./fake-codex-answers.mjs";

/** The nutritionist's plan: an assessment, a favour, a supplement flagged against the profile, a recheck. */
export function nutritionistAnswer(args, prompt) {
  return answerOrMissing(args, prompt, (ref) => ({
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
  }));
}

/** The trainer's programme: a walk within clearance, strength that needs it, a stop rule, a recheck. */
export function trainerAnswer(args, prompt) {
  return answerOrMissing(args, prompt, (ref) => {
    const adherence = /"adherence":\{"days":28,"done":(\d+),"skipped":(\d+)/.exec(prompt);
    const progression =
      adherence !== null && Number(adherence[1]) >= 3
        ? "через 4 недели добавить 5–10 минут к каждой прогулке"
        : "пока держать ту же нагрузку; прибавлять, когда наберётся три недели регулярных отметок";
    return {
      urgency: { tier: "routine", reasons: ref },
      blocks: [
        {
          kind: "activity_assessment",
          text: "Синтетический показатель A выше напечатанного диапазона — нагрузку стоит наращивать осторожно.",
          refs: ref,
        },
        {
          kind: "activity_recommendation",
          name: "Быстрая ходьба",
          activityKind: "aerobic",
          load: "3 раза в неделю по 30 минут в разговорном темпе",
          progression,
          rationale: "Умеренная аэробная нагрузка при таком значении A обычно уместна.",
          refs: ref,
          clearance: "within",
          conflictNotes: null,
          confirmWith: "physiotherapist",
        },
        {
          kind: "activity_recommendation",
          name: "Силовые упражнения с отягощением",
          activityKind: "strength",
          load: "2 раза в неделю, лёгкий вес, без задержки дыхания",
          progression: null,
          rationale: "При таком значении A силовую нагрузку стоит начинать после слова врача.",
          refs: ref,
          clearance: "needs_clearance",
          conflictNotes: "В профиле нет записанного допуска к силовой нагрузке.",
          confirmWith: "cardiologist",
        },
        {
          kind: "activity_recommendation",
          name: "Прекратить при боли в груди, одышке или головокружении",
          activityKind: "avoid",
          load: "при любой нагрузке",
          progression: null,
          rationale: "Сигналы, при которых занятие останавливают и обращаются к врачу.",
          refs: ref,
          clearance: "within",
          conflictNotes: null,
          confirmWith: "therapist",
        },
        {
          kind: "recheck",
          text: "Повторить синтетический показатель A после шести недель регулярной ходьбы.",
          when: "через 6 недель",
          refs: ref,
        },
      ],
    };
  });
}
