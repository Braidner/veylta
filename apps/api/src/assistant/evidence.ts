import type { AssistantEvidenceItem, MedicalProfileEntryKind } from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { ProfileScope } from "../family/profile-access.js";

/**
 * What one assistant turn is allowed to see, and exactly what the egress notice names: confirmed
 * observations with their printed ranges, the person's own profile, and the care plan. Never an
 * unconfirmed extraction, never a document, never an identifier beyond the observation ids the
 * answer must cite.
 */
export interface AssistantEvidence {
  readonly medicalProfile: {
    readonly interpretationReady: boolean;
    readonly entries: readonly {
      readonly kind: MedicalProfileEntryKind;
      readonly value: string;
      readonly recordedOn: string | null;
    }[];
  };
  readonly observations: readonly AssistantObservation[];
  readonly carePlan: readonly {
    readonly category: string;
    readonly title: string;
    readonly state: string;
    readonly scheduledFor: string | null;
  }[];
}

export interface AssistantObservation {
  readonly observationId: string;
  readonly code: string | null;
  readonly name: string;
  readonly value: string;
  readonly unit: string;
  readonly referenceRange: {
    readonly text: string | null;
    readonly low: string | null;
    readonly high: string | null;
    readonly laboratoryFlag: boolean | null;
  } | null;
  readonly sampledAt: string | null;
  readonly laboratory: string | null;
}

interface ObservationRow {
  id: string;
  canonical_code: string | null;
  source_name: string;
  source_value: string;
  source_unit: string;
  sampled_at: string | null;
  resulted_at: string | null;
  uploaded_at: string;
  laboratory: string | null;
  reference_text: string | null;
  reference_low: string | null;
  reference_high: string | null;
  reference_flag: number | null;
  document_id: string;
  page_number: number;
}

/** The evidence as the model sees it, and the source index the UI needs to resolve its refs. */
export interface AssistantEvidenceBundle {
  readonly evidence: AssistantEvidence;
  readonly sources: readonly AssistantEvidenceItem[];
}

/** Bounded so one profile's whole history cannot blow the prompt: the newest per analyte first. */
const maximumObservations = 200;
const maximumPerAnalyte = 4;

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
      ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC, o.id`,
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
  const plan = await client.query<{
    category: string;
    title: string;
    state: string;
    scheduled_for: string | null;
  }>(
    `SELECT category, title, state, scheduled_for FROM care_plan_items
      WHERE family_id = $1 AND patient_profile_id = $2 AND state IN ('proposed', 'accepted')
      ORDER BY created_at DESC LIMIT 50`,
    [scope.familyId, scope.profileId],
  );
  const kinds = new Set(entries.rows.map((entry) => entry.kind));
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
      carePlan: plan.rows.map((item) => ({
        category: item.category,
        title: item.title,
        state: item.state,
        scheduledFor: item.scheduled_for,
      })),
    },
    sources,
  };
}

/** The parser's view of the evidence: which ids may be cited, which numbers are the person's. */
export function answerContextOf(evidence: AssistantEvidence) {
  return {
    knownObservationIds: new Set(evidence.observations.map((item) => item.observationId)),
    profileValues: new Set(
      evidence.observations.flatMap((item) => [item.value, item.value.replace(",", ".")]),
    ),
    interpretationReady: evidence.medicalProfile.interpretationReady,
  };
}
