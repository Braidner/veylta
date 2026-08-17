import { randomUUID } from "node:crypto";
import {
  CLINICIAN_RECORD_CONTRACT_VERSION,
  CLINICIAN_RECORD_KINDS,
  type ClinicianRecordDecisionRequest,
  type ClinicianRecordDecisionResponse,
  type ClinicianRecordItem,
  type ClinicianRecordKind,
  type ClinicianRecordsResponse,
  type DocumentIntelligenceStructuredResult,
  MAX_CLINICIAN_RECORD_TEXT,
} from "@veylta/contracts";
import type { Database, DatabaseClient } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import {
  canonicalProfileScope,
  type ProfileScope,
  profileAccess,
  requireProfileWrite,
} from "../family/profile-access.js";
import { auditRecordDecision, insertRecord, loadRecords, type RecordRow } from "./storage.js";

export interface ClinicianRecordService {
  list(
    actor: SessionActor,
    scope: ProfileScope,
    documentId: string,
  ): Promise<ClinicianRecordsResponse>;
  decide(
    actor: SessionActor,
    scope: ProfileScope,
    documentId: string,
    resultKey: string,
    input: ClinicianRecordDecisionRequest,
    correlationId: string,
  ): Promise<{ response: ClinicianRecordDecisionResponse; created: boolean }>;
}

const kinds: ReadonlySet<string> = new Set(CLINICIAN_RECORD_KINDS);
const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Analysis {
  readonly id: string;
  readonly documentVersionId: string;
  readonly documentDate: string | null;
  readonly results: readonly DocumentIntelligenceStructuredResult[];
}

/** The document's latest completed analysis — the statements the person can decide on. */
async function latestAnalysis(
  client: Pick<DatabaseClient, "query">,
  scope: ProfileScope,
  documentId: string,
): Promise<Analysis | null> {
  const document = (
    await client.query<{ id: string }>(
      `SELECT id FROM documents
        WHERE family_id = $1 AND patient_profile_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [scope.familyId, scope.profileId, documentId],
    )
  ).rows[0];
  if (document === undefined) throw new ResourceNotFoundError();
  const row = (
    await client.query<{
      id: string;
      document_version_id: string;
      document_date: string | null;
      structured_results_json: string;
    }>(
      `SELECT id, document_version_id, document_date, structured_results_json
         FROM document_intelligence_results
        WHERE family_id = $1 AND document_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [scope.familyId, documentId],
    )
  ).rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    documentVersionId: row.document_version_id,
    documentDate: row.document_date,
    results: JSON.parse(row.structured_results_json) as DocumentIntelligenceStructuredResult[],
  };
}

const isRecordKind = (value: string): value is ClinicianRecordKind => kinds.has(value);

function item(result: DocumentIntelligenceStructuredResult, row: RecordRow | undefined) {
  if (!isRecordKind(result.type)) return null;
  const record: ClinicianRecordItem = {
    resultKey: result.resultKey,
    kind: result.type,
    extracted: { label: result.label, detail: result.value },
    source: { pageNumber: result.source.pageNumber, fragment: result.source.fragment },
    record:
      row === undefined
        ? null
        : {
            id: row.id,
            decision: row.decision,
            label: row.label,
            detail: row.detail,
            decidedAt: row.decided_at,
          },
  };
  return record;
}

function boundedText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_CLINICIAN_RECORD_TEXT) {
    throw new DomainValidationError(`${field} must be 1..${MAX_CLINICIAN_RECORD_TEXT} characters`);
  }
  return trimmed;
}

export function createClinicianRecordService(database: Database): ClinicianRecordService {
  const canonicalDocumentId = (value: string): string => {
    const id = value.toLowerCase();
    if (!canonicalUuidPattern.test(id)) throw new ResourceNotFoundError();
    return id;
  };

  return {
    async list(actor, requestedScope, requestedDocumentId) {
      const scope = canonicalProfileScope(requestedScope);
      const documentId = canonicalDocumentId(requestedDocumentId);
      return database.transaction(async (client) => {
        await profileAccess(client, actor, scope);
        const analysis = await latestAnalysis(client, scope, documentId);
        const rows = analysis === null ? [] : await loadRecords(client, scope, analysis.id);
        const byKey = new Map(rows.map((row) => [row.result_key, row]));
        return {
          contractVersion: CLINICIAN_RECORD_CONTRACT_VERSION,
          documentId,
          intelligenceResultId: analysis?.id ?? null,
          documentDate: analysis?.documentDate ?? null,
          items: (analysis?.results ?? [])
            .map((result) => item(result, byKey.get(result.resultKey)))
            .filter((entry): entry is ClinicianRecordItem => entry !== null),
        };
      });
    },

    async decide(actor, requestedScope, requestedDocumentId, resultKey, input, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const documentId = canonicalDocumentId(requestedDocumentId);
      if (input.correction !== undefined && input.decision !== "confirm") {
        throw new DomainValidationError("Only a confirmation carries a correction");
      }
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const analysis = await latestAnalysis(client, scope, documentId);
        if (analysis === null) throw new ResourceNotFoundError();
        // A decision binds to one analysis: a re-analysed document asks again.
        if (analysis.id !== input.intelligenceResultId) {
          throw new DomainConflictError();
        }
        const result = analysis.results.find((entry) => entry.resultKey === resultKey);
        if (result === undefined || !isRecordKind(result.type)) throw new ResourceNotFoundError();
        const decision = input.decision === "confirm" ? "confirmed" : "rejected";
        const label = boundedText(input.correction?.label ?? result.label, "label");
        const detailRaw = input.correction === undefined ? result.value : input.correction.detail;
        const detail = detailRaw === null ? null : boundedText(detailRaw, "detail");
        const existing = (await loadRecords(client, scope, analysis.id)).find(
          (row) => row.result_key === resultKey,
        );
        if (existing !== undefined) {
          const same =
            existing.decision === decision &&
            existing.label === label &&
            existing.detail === detail;
          if (!same) throw new DomainConflictError();
          const replay = item(result, existing);
          if (replay === null) throw new ResourceNotFoundError();
          return {
            response: { contractVersion: CLINICIAN_RECORD_CONTRACT_VERSION, item: replay },
            created: false,
          };
        }
        const now = new Date();
        const row: RecordRow = {
          id: randomUUID(),
          result_key: resultKey,
          kind: result.type,
          label,
          detail,
          page_number: result.source.pageNumber,
          source_fragment: result.source.fragment,
          document_date: analysis.documentDate,
          decision,
          decided_at: now.toISOString(),
        };
        await insertRecord(client, {
          scope,
          actor,
          documentId,
          documentVersionId: analysis.documentVersionId,
          intelligenceResultId: analysis.id,
          row,
        });
        await auditRecordDecision(client, { actor, scope, row, correlationId, now });
        const created = item(result, row);
        if (created === null) throw new ResourceNotFoundError();
        return {
          response: { contractVersion: CLINICIAN_RECORD_CONTRACT_VERSION, item: created },
          created: true,
        };
      });
    },
  };
}
