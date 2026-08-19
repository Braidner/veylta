import { randomUUID } from "node:crypto";
import {
  DOCUMENT_CONTRACT_VERSION,
  type DocumentDateResponse,
  latestCorrectableDate,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import {
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import { canonicalProfileScope, requireProfileWrite } from "../family/profile-access.js";
import { effectiveDocumentDate, isCalendarDate } from "./document-date.js";

interface DocumentDateRow {
  document_date_override: string | null;
  uploaded_at: string;
  intelligence_document_date: string | null;
}

/**
 * The person's correction of a document's date. Null drops it; a malformed day or one after
 * tomorrow (UTC) is a 422; a document the session may not write, or none, is a 404. The same
 * value again changes nothing and writes no audit row; the audit row never carries the date.
 */
export async function setDocumentDate(
  database: Database,
  input: {
    actor: SessionActor;
    scope: { familyId: string; profileId: string; documentId: string };
    documentDate: string | null;
    correlationId: string;
    now?: Date;
  },
): Promise<DocumentDateResponse> {
  const scope = canonicalProfileScope(input.scope);
  const documentId = input.scope.documentId.toLowerCase();
  const now = input.now ?? new Date();
  if (
    input.documentDate !== null &&
    (!isCalendarDate(input.documentDate) || input.documentDate > latestCorrectableDate(now))
  ) {
    throw new DomainValidationError();
  }
  return database.transaction(async (client) => {
    await requireProfileWrite(client, input.actor, scope);
    const current = (
      await client.query<DocumentDateRow>(
        `SELECT d.document_date_override,
                d.uploaded_at,
                intelligence.document_date AS intelligence_document_date
           FROM documents d
           JOIN document_versions v
             ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
           LEFT JOIN document_intelligence_results intelligence
             ON intelligence.id = (
               SELECT latest.id FROM document_intelligence_results latest
                WHERE latest.family_id = d.family_id AND latest.document_version_id = v.id
                ORDER BY latest.created_at DESC, latest.id DESC
                LIMIT 1
             )
          WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.id = $3 AND d.deleted_at IS NULL`,
        [scope.familyId, scope.profileId, documentId],
      )
    ).rows[0];
    if (current === undefined) throw new ResourceNotFoundError();
    const effective = (override: string | null) =>
      effectiveDocumentDate({
        override,
        documentDate: current.intelligence_document_date,
        uploadedAt: current.uploaded_at,
      });
    const response = (override: string | null): DocumentDateResponse => ({
      contractVersion: DOCUMENT_CONTRACT_VERSION,
      documentId,
      effectiveDate: effective(override),
    });
    if (current.document_date_override === input.documentDate) return response(input.documentDate);
    await client.query(
      `UPDATE documents SET document_date_override = $1
        WHERE family_id = $2 AND patient_profile_id = $3 AND id = $4`,
      [input.documentDate, scope.familyId, scope.profileId, documentId],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, family_id, actor_user_id, action, resource_type, resource_id, result,
          correlation_id, metadata, created_at)
       VALUES ($1, $2, $3, 'document.date.corrected', 'Document', $4, 'success', $5, $6, $7)`,
      [
        randomUUID(),
        scope.familyId,
        input.actor.userId,
        documentId,
        input.correlationId,
        { contractVersion: DOCUMENT_CONTRACT_VERSION },
        now,
      ],
    );
    return response(input.documentDate);
  });
}
