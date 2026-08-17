import { randomUUID } from "node:crypto";
import {
  MEDICAL_PROFILE_CONTRACT_VERSION,
  MEDICAL_PROFILE_ENTRY_KINDS,
  type MedicalProfileEntry,
  type MedicalProfileEntryKind,
  type MedicalProfileEntryResponse,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import {
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import type { ProfileScope } from "../family/profile-access.js";

export interface EntryRow {
  id: string;
  kind: string;
  value: string;
  recorded_on: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export const kinds = new Set<string>(MEDICAL_PROFILE_ENTRY_KINDS);
const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function canonicalEntryId(value: string): string {
  const id = value.toLowerCase();
  if (!canonicalUuidPattern.test(id)) throw new DomainValidationError();
  return id;
}

export function recordedOn(value: string | null): string | null {
  if (value === null) return null;
  if (!localDatePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new DomainValidationError();
  }
  return value;
}

export function entryFromRow(row: EntryRow): MedicalProfileEntry {
  if (!kinds.has(row.kind)) throw new Error("Stored medical profile kind is invalid");
  return {
    id: row.id,
    kind: row.kind as MedicalProfileEntryKind,
    value: row.value,
    recordedOn: row.recorded_on,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const entrySelect = `SELECT id, kind, value, recorded_on, revision, created_at, updated_at, archived_at
                       FROM medical_profile_entries`;

export async function loadEntry(
  client: DatabaseClient,
  scope: ProfileScope,
  entryId: string,
): Promise<EntryRow> {
  const row = (
    await client.query<EntryRow>(
      `${entrySelect} WHERE family_id = $1 AND patient_profile_id = $2 AND id = $3`,
      [scope.familyId, scope.profileId, entryId],
    )
  ).rows[0];
  if (row === undefined) throw new ResourceNotFoundError();
  return row;
}

export async function audit(
  client: DatabaseClient,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    action: string;
    entryId: string;
    correlationId: string;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, 'MedicalProfileEntry', $5, 'success', $6, $7, $8)`,
    [
      randomUUID(),
      input.scope.familyId,
      input.actor.userId,
      input.action,
      input.entryId,
      input.correlationId,
      { contractVersion: MEDICAL_PROFILE_CONTRACT_VERSION },
      input.now,
    ],
  );
}

export function response(scope: ProfileScope, row: EntryRow): MedicalProfileEntryResponse {
  return {
    contractVersion: MEDICAL_PROFILE_CONTRACT_VERSION,
    profileId: scope.profileId,
    entry: entryFromRow(row),
  };
}
