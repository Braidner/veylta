import { randomUUID } from "node:crypto";
import {
  CLINICIAN_RECORD_CONTRACT_VERSION,
  type ClinicianRecordDecision,
  type ClinicianRecordKind,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { SessionActor } from "../family/family-service.js";
import type { ProfileScope } from "../family/profile-access.js";

export interface RecordRow {
  id: string;
  result_key: string;
  kind: ClinicianRecordKind;
  label: string;
  detail: string | null;
  page_number: number;
  source_fragment: string;
  document_date: string | null;
  decision: ClinicianRecordDecision;
  decided_at: string;
}

/** The decisions taken over one analysis of a document, in the order they were taken. */
export async function loadRecords(
  client: Pick<DatabaseClient, "query">,
  scope: ProfileScope,
  intelligenceResultId: string,
): Promise<RecordRow[]> {
  const rows = await client.query<RecordRow>(
    `SELECT id, result_key, kind, label, detail, page_number, source_fragment, document_date,
            decision, decided_at
       FROM clinician_records
      WHERE family_id = $1 AND patient_profile_id = $2 AND intelligence_result_id = $3
      ORDER BY decided_at, rowid`,
    [scope.familyId, scope.profileId, intelligenceResultId],
  );
  return rows.rows;
}

export async function insertRecord(
  client: Pick<DatabaseClient, "query">,
  input: {
    scope: ProfileScope;
    actor: SessionActor;
    documentId: string;
    documentVersionId: string;
    intelligenceResultId: string;
    row: RecordRow;
  },
): Promise<void> {
  const { scope, actor, row } = input;
  await client.query(
    `INSERT INTO clinician_records
       (id, family_id, patient_profile_id, document_id, document_version_id,
        intelligence_result_id, result_key, kind, label, detail, page_number, source_fragment,
        document_date, decision, decided_by_user_id, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      row.id,
      scope.familyId,
      scope.profileId,
      input.documentId,
      input.documentVersionId,
      input.intelligenceResultId,
      row.result_key,
      row.kind,
      row.label,
      row.detail,
      row.page_number,
      row.source_fragment,
      row.document_date,
      row.decision,
      actor.userId,
      row.decided_at,
    ],
  );
}

/** Payload-free, like every audit row: who decided what kind of thing about which record. */
export async function auditRecordDecision(
  client: Pick<DatabaseClient, "query">,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    row: RecordRow;
    correlationId: string;
    now: Date;
  },
): Promise<void> {
  const { actor, scope, row } = input;
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, 'ClinicianRecord', $5, 'success', $6, $7, $8)`,
    [
      randomUUID(),
      scope.familyId,
      actor.userId,
      `review.clinician_record.${row.decision}`,
      row.id,
      input.correlationId,
      { contractVersion: CLINICIAN_RECORD_CONTRACT_VERSION },
      input.now,
    ],
  );
}
