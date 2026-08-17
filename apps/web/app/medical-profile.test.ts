import assert from "node:assert/strict";
import test from "node:test";
import type { MedicalProfileEntry } from "@veylta/contracts";
import {
  isSingletonKind,
  medicalProfileGroups,
  medicalProfileInput,
  medicalProfileKindLabels,
  medicalProfileReadinessCopy,
  medicalProfileValueCopy,
} from "./medical-profile.js";

function entry(kind: MedicalProfileEntry["kind"], value: string): MedicalProfileEntry {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind,
    value,
    recordedOn: null,
    revision: 1,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
  };
}

test("every kind has a label and belongs to exactly one group", () => {
  const grouped = medicalProfileGroups.flatMap((group) => group.kinds);
  assert.deepEqual([...grouped].sort(), Object.keys(medicalProfileKindLabels).sort());
  assert.equal(new Set(grouped).size, grouped.length);
});

test("closed and numeric kinds get their words back; the rest stay verbatim", () => {
  assert.equal(medicalProfileValueCopy(entry("sex", "female")), "Женский");
  assert.equal(medicalProfileValueCopy(entry("pregnancy", "lactating")), "Грудное вскармливание");
  assert.equal(medicalProfileValueCopy(entry("weight_kg", "72.5")), "72.5 кг");
  assert.equal(medicalProfileValueCopy(entry("medication", "Препарат A")), "Препарат A");
  assert.equal(medicalProfileInput("sex").control, "select");
  assert.equal(medicalProfileInput("birth_year").control, "number");
  assert.deepEqual(medicalProfileInput("medication"), {
    control: "text",
    placeholder: "Название, доза, как принимаете",
    dated: true,
  });
  assert.equal(isSingletonKind("sex"), true);
  assert.equal(isSingletonKind("symptom"), false);
});

test("readiness copy names exactly what is still missing", () => {
  assert.match(medicalProfileReadinessCopy([]) ?? "", /пол и год рождения/);
  assert.match(
    medicalProfileReadinessCopy([entry("sex", "male")]) ?? "",
    /^Ассистенты.*год рождения/,
  );
  assert.equal(
    medicalProfileReadinessCopy([entry("sex", "male"), entry("birth_year", "1992")]),
    null,
  );
});
