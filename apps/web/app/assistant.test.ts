import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSISTANT_REJECTION_REASONS,
  ASSISTANT_SPECIALTIES,
  ASSISTANT_URGENCY_TIERS,
  type AssistantEvidenceItem,
} from "@veylta/contracts";
import { ApiError } from "./api-client";
import {
  assistantSendErrorCopy,
  egressDisclosure,
  invitationCopy,
  invitationSummary,
  referralItem,
  referralsOf,
  refusalCopy,
  speakerLabel,
  specialtyLabel,
  urgencyCopy,
} from "./assistant";

test("every closed reason, tier and specialty has fixed Russian copy", () => {
  for (const reason of ASSISTANT_REJECTION_REASONS) assert.match(refusalCopy[reason], /[а-я]/);
  for (const tier of ASSISTANT_URGENCY_TIERS) assert.match(urgencyCopy[tier].label, /[а-я]/);
  for (const specialty of ASSISTANT_SPECIALTIES) assert.match(specialtyLabel[specialty], /[а-я]/);
  assert.equal(urgencyCopy.emergency.tone, "alarm");
  assert.equal(urgencyCopy.none.tone, "calm");
});

test("the egress disclosure names the evidence count and the profile's readiness", () => {
  assert.deepEqual(egressDisclosure({ evidenceCount: 1, interpretationReady: true }), [
    "1 подтверждённое значение с напечатанными референсами, датами и лабораторией",
    "записи медицинского профиля: пол, год рождения и всё, что вы добавили",
    "принятые и предложенные пункты плана",
  ]);
  assert.match(
    egressDisclosure({ evidenceCount: 5, interpretationReady: false })[0] ?? "",
    /^5 подтверждённых значений/,
  );
  assert.match(
    egressDisclosure({ evidenceCount: 0, interpretationReady: false })[1] ?? "",
    /пока не указаны/,
  );
});

test("accepting a referral yields a bounded clinician item that names the specialty", () => {
  const item = referralItem({
    kind: "hypothesis",
    name: "Синтетическое состояние A",
    confidence: "moderate",
    rationale: "Значение A выше диапазона.",
    refs: [],
    confirmWith: "endocrinologist",
    workup: [],
  });
  assert.deepEqual(item, {
    category: "clinician",
    title: "Подтвердить у специалиста (эндокринолог): Синтетическое состояние A",
    note: "Значение A выше диапазона.",
    scheduledFor: null,
  });
  const long = referralItem({
    kind: "treatment_option",
    name: "Д".repeat(200),
    treatmentKind: "lifestyle",
    rationale: "Р".repeat(600),
    refs: [],
    contraindications: "unknown",
    conflictNotes: null,
    confirmWith: "therapist",
  });
  assert.equal(long.title.length, 120);
  assert.equal(long.note?.length, 500);
});

test("only hypotheses and treatment options carry a referral", () => {
  const referrals = referralsOf({
    urgency: { tier: "none", reasons: [] },
    blocks: [
      { kind: "general", text: "Справка." },
      {
        kind: "hypothesis",
        name: "A",
        confidence: "low",
        rationale: "r",
        refs: [],
        confirmWith: "therapist",
        workup: [],
      },
      { kind: "missing", context: "sex" },
    ],
  });
  assert.deepEqual(
    referrals.map((block) => block.kind),
    ["hypothesis"],
  );
});

test("send errors map the disclosure gate and conversation limits to their own copy", () => {
  assert.match(
    assistantSendErrorCopy(new ApiError(409, "ACKNOWLEDGEMENT_REQUIRED")),
    /подтвердите/,
  );
  assert.match(assistantSendErrorCopy(new ApiError(409, "CONFLICT")), /новый/);
  assert.match(assistantSendErrorCopy(new Error("network")), /соединение/);
});

test("the panel explains each invitation by the printed names in that specialist's field", () => {
  const evidence = new Map([
    [
      "o1",
      {
        observationId: "o1",
        code: "tsh",
        name: "ТТГ",
        value: "6.8",
        unit: "мМЕ/л",
        sampledAt: null,
        documentId: "d",
        pageNumber: 1,
      },
    ],
  ]);
  assert.equal(
    invitationCopy({ specialty: "endocrinologist", observationIds: ["o1", "o1"] }, evidence),
    "в данных: ТТГ",
  );
  assert.equal(
    invitationCopy({ specialty: "cardiologist", observationIds: [] }, evidence),
    "по вашему запросу",
  );
  // The composer names a few and counts the rest, so a specialist with forty analytes stays a chip.
  const many = new Map(
    ["Ферритин", "Гемоглобин (Hb)", "Лейкоциты", "Тромбоциты", "Эритроциты"].map((name, index) => [
      `h${index}`,
      { ...(evidence.get("o1") as AssistantEvidenceItem), observationId: `h${index}`, name },
    ]),
  );
  assert.equal(
    invitationSummary({ specialty: "hematologist", observationIds: [...many.keys(), "h0"] }, many),
    "в данных: Ферритин, Гемоглобин (Hb), Лейкоциты и ещё 2",
  );
  assert.equal(
    invitationSummary({ specialty: "hematologist", observationIds: ["h0", "h1"] }, many),
    "в данных: Ферритин, Гемоглобин (Hb)",
  );
  assert.equal(speakerLabel(null), "ИИ-врач");
  assert.equal(speakerLabel("endocrinologist"), "ИИ-эндокринолог");
});
