import {
  type AssistantEvidenceItem,
  CARE_PLAN_CHECKIN_DAYS,
  type MedicalProfileEntryKind,
} from "@veylta/contracts";
import { checkinsByItem } from "../care-plan/care-plan-checkins.js";
import type { DatabaseClient } from "../database/pool.js";
import type { ProfileScope } from "../family/profile-access.js";
import type {
  AssistantEvidence,
  AssistantEvidenceBundle,
  AssistantObservation,
  ObservationRow,
  RecordRow,
} from "./evidence-types.js";

export type {
  AssistantClinicianRecord,
  AssistantEvidence,
  AssistantEvidenceBundle,
  AssistantObservation,
  AssistantPlanItem,
} from "./evidence-types.js";

/** Bounded so one profile's whole history cannot blow the prompt: the newest per analyte first. */
const maximumObservations = 200;
const maximumPerAnalyte = 4;
const maximumRecords = 100;
const maximumAdherenceNotes = 5;

/** What the person did with one regimen item over the window: counts and their last few notes. */
function adherenceOf(marks: readonly { status: string; note: string | null }[] | undefined) {
  if (marks === undefined || marks.length === 0) return {};
  const notes = marks.flatMap((mark) => (mark.note === null ? [] : [mark.note]));
  return {
    adherence: {
      days: CARE_PLAN_CHECKIN_DAYS,
      done: marks.filter((mark) => mark.status === "done").length,
      skipped: marks.filter((mark) => mark.status === "skipped").length,
      notes: notes.slice(-maximumAdherenceNotes),
    },
  };
}

export async function loadAssistantEvidence(
  client: DatabaseClient,
  scope: ProfileScope,
): Promise<AssistantEvidenceBundle> {
  const entries = await client.query<{
    kind: MedicalProfileEntryKind;
    value: string;
    recorded_on: string | null;
  }>(
    `SELECT kind, value, recorded_on FROM medical_profile_entries
      WHERE family_id = $1 AND patient_profile_id = $2 AND archived_at IS NULL
      ORDER BY created_at, rowid`,
    [scope.familyId, scope.profileId],
  );
  const observations = await client.query<ObservationRow>(
    `SELECT o.id, o.canonical_code, o.source_name, o.source_value, o.source_unit,
            o.sampled_at, o.resulted_at, o.uploaded_at, o.laboratory,
            r.source_text AS reference_text, r.source_low AS reference_low,
            r.source_high AS reference_high, r.laboratory_out_of_range AS reference_flag,
            o.document_id, page.page_number
       FROM observations o
       JOIN documents d ON d.family_id = o.family_id AND d.id = o.document_id AND d.deleted_at IS NULL
       JOIN document_pages page
         ON page.family_id = o.family_id AND page.id = o.document_page_id
       LEFT JOIN observation_reference_ranges r
         ON r.family_id = o.family_id AND r.observation_id = o.id
      WHERE o.family_id = $1 AND o.patient_profile_id = $2 AND o.status = 'confirmed'
      ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC, o.rowid`,
    [scope.familyId, scope.profileId],
  );
  const perAnalyte = new Map<string, number>();
  const kept: AssistantObservation[] = [];
  const sources: AssistantEvidenceItem[] = [];
  for (const row of observations.rows) {
    const analyte = row.canonical_code ?? row.source_name.toLowerCase();
    const seen = perAnalyte.get(analyte) ?? 0;
    if (seen >= maximumPerAnalyte || kept.length >= maximumObservations) continue;
    perAnalyte.set(analyte, seen + 1);
    sources.push({
      observationId: row.id,
      code: row.canonical_code,
      name: row.source_name,
      value: row.source_value,
      unit: row.source_unit,
      sampledAt: row.sampled_at ?? row.resulted_at,
      documentId: row.document_id,
      pageNumber: row.page_number,
    });
    kept.push({
      observationId: row.id,
      code: row.canonical_code,
      name: row.source_name,
      value: row.source_value,
      unit: row.source_unit,
      referenceRange:
        row.reference_text === null && row.reference_low === null && row.reference_high === null
          ? null
          : {
              text: row.reference_text,
              low: row.reference_low,
              high: row.reference_high,
              laboratoryFlag: row.reference_flag === null ? null : row.reference_flag === 1,
            },
      sampledAt: row.sampled_at ?? row.resulted_at,
      laboratory: row.laboratory,
    });
  }
  const records = await client.query<RecordRow>(
    `SELECT r.id, r.kind, r.label, r.detail, r.document_date, r.document_id, r.page_number
       FROM clinician_records r
       JOIN documents d ON d.family_id = r.family_id AND d.id = r.document_id AND d.deleted_at IS NULL
      WHERE r.family_id = $1 AND r.patient_profile_id = $2 AND r.decision = 'confirmed'
      ORDER BY COALESCE(r.document_date, substr(r.decided_at, 1, 10)) DESC, r.decided_at DESC, r.rowid
      LIMIT ${maximumRecords}`,
    [scope.familyId, scope.profileId],
  );
  const plan = await client.query<{
    id: string;
    category: string;
    title: string;
    state: string;
    scheduled_for: string | null;
  }>(
    `SELECT id, category, title, state, scheduled_for FROM care_plan_items
      WHERE family_id = $1 AND patient_profile_id = $2 AND state IN ('proposed', 'accepted')
      ORDER BY created_at DESC LIMIT 50`,
    [scope.familyId, scope.profileId],
  );
  const marks = await checkinsByItem(client, scope, new Date());
  const kinds = new Set(entries.rows.map((entry) => entry.kind));
  const recordItems = records.rows.map((row) => ({
    recordId: row.id,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    documentDate: row.document_date,
    documentId: row.document_id,
    pageNumber: row.page_number,
  }));
  return {
    evidence: {
      medicalProfile: {
        interpretationReady: kinds.has("sex") && kinds.has("birth_year"),
        entries: entries.rows.map((entry) => ({
          kind: entry.kind,
          value: entry.value,
          recordedOn: entry.recorded_on,
        })),
      },
      observations: kept,
      clinicianRecords: recordItems.map(({ documentId: _d, pageNumber: _p, ...record }) => record),
      carePlan: plan.rows.map((item) => ({
        category: item.category,
        title: item.title,
        state: item.state,
        scheduledFor: item.scheduled_for,
        ...adherenceOf(marks.get(item.id)),
      })),
    },
    sources,
    records: recordItems,
  };
}

/** The parser's view of the evidence: which ids may be cited, which numbers are the person's. */
export function answerContextOf(evidence: AssistantEvidence) {
  return {
    knownObservationIds: new Set(evidence.observations.map((item) => item.observationId)),
    knownRecordIds: new Set(evidence.clinicianRecords.map((item) => item.recordId)),
    profileValues: new Set(
      evidence.observations.flatMap((item) => [item.value, item.value.replace(",", ".")]),
    ),
    interpretationReady: evidence.medicalProfile.interpretationReady,
  };
}
