import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianRecordItem } from "@veylta/contracts";
import {
  checkQuestion,
  clinicianRecordKindLabel,
  confirmedRecordsCopy,
  recordCounts,
  recordCountsLine,
  recordText,
} from "./clinician-records";

const item = (
  kind: ClinicianRecordItem["kind"],
  label: string,
  detail: string | null,
  record: ClinicianRecordItem["record"] = null,
): ClinicianRecordItem => ({
  resultKey: `k-${label}`,
  kind,
  extracted: { label, detail },
  source: { pageNumber: 1, fragment: `RECORD|${kind}|${label}` },
  record,
});

test("records are counted and named as decisions the person took", () => {
  const items = [
    item("diagnosis", "Синтетический гипотиреоз", "E03.9", {
      id: "r1",
      decision: "confirmed",
      label: "Синтетический гипотиреоз",
      detail: "E03.9",
      decidedAt: "2026-08-17T10:00:00.000Z",
    }),
    item("medication", "Левотироксин", "25 мкг утром, 8 недель", {
      id: "r2",
      decision: "confirmed",
      label: "Левотироксин",
      detail: "25 мкг утром",
      decidedAt: "2026-08-17T10:01:00.000Z",
    }),
    item("finding", "Узлов нет", null, {
      id: "r3",
      decision: "rejected",
      label: "Узлов нет",
      detail: null,
      decidedAt: "2026-08-17T10:02:00.000Z",
    }),
    item("referral", "Консультация эндокринолога", "через 6 недель"),
  ];
  assert.deepEqual(recordCounts(items), { confirmed: 2, rejected: 1, pending: 1 });
  assert.equal(
    recordCountsLine(recordCounts(items)),
    "2 подтверждены · 1 отклонена · 1 ждёт решения",
  );
  assert.equal(recordCountsLine({ confirmed: 0, rejected: 0, pending: 0 }), "записей нет");
  assert.deepEqual(recordText(items[1] as ClinicianRecordItem), {
    label: "Левотироксин",
    detail: "25 мкг утром",
  });
  assert.equal(
    confirmedRecordsCopy(items),
    "Диагноз: Синтетический гипотиреоз (E03.9); Назначение: Левотироксин (25 мкг утром)",
  );
  assert.equal(clinicianRecordKindLabel.follow_up, "Контроль");
  assert.equal(
    checkQuestion(items, "2026-08-12"),
    "Сверь записи врача из документа от 12.08.2026 с моим досье и подтверждёнными значениями: Диагноз: Синтетический гипотиреоз (E03.9); Назначение: Левотироксин (25 мкг утром). Где вы согласны, где расходитесь и почему, и что спросить на визите?",
  );
});
