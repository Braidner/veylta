import {
  MAX_MEDICAL_PROFILE_ENTRIES,
  MEDICAL_PROFILE_CONTRACT_VERSION,
  MEDICAL_PROFILE_SINGLETON_KINDS,
  type MedicalProfileEntryArchiveRequest,
  type MedicalProfileEntryCreateRequest,
  type MedicalProfileEntryKind,
  type MedicalProfileEntryResponse,
  type MedicalProfileEntryUpdateRequest,
  type MedicalProfileResponse,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
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
import {
  audit,
  canonicalEntryId,
  type EntryRow,
  entryFromRow,
  entrySelect,
  kinds,
  loadEntry,
  recordedOn,
  response,
} from "./medical-profile-storage.js";
import { medicalProfileEntryValue } from "./medical-profile-values.js";

const singletonKinds = new Set<string>(MEDICAL_PROFILE_SINGLETON_KINDS);

export interface MedicalProfileService {
  get(
    actor: SessionActor,
    scope: ProfileScope,
    correlationId: string,
  ): Promise<MedicalProfileResponse>;
  createEntry(
    actor: SessionActor,
    scope: ProfileScope,
    entryId: string,
    input: MedicalProfileEntryCreateRequest,
    correlationId: string,
  ): Promise<{ readonly response: MedicalProfileEntryResponse; readonly created: boolean }>;
  updateEntry(
    actor: SessionActor,
    scope: ProfileScope,
    entryId: string,
    input: MedicalProfileEntryUpdateRequest,
    correlationId: string,
  ): Promise<MedicalProfileEntryResponse>;
  archiveEntry(
    actor: SessionActor,
    scope: ProfileScope,
    entryId: string,
    input: MedicalProfileEntryArchiveRequest,
    correlationId: string,
  ): Promise<MedicalProfileEntryResponse>;
}

export function createMedicalProfileService(database: Database): MedicalProfileService {
  return {
    async get(actor, requestedScope) {
      const scope = canonicalProfileScope(requestedScope);
      return database.transaction(async (client) => {
        const { canWrite } = await profileAccess(client, actor, scope);
        const rows = await client.query<EntryRow>(
          `${entrySelect}
            WHERE family_id = $1 AND patient_profile_id = $2 AND archived_at IS NULL
            ORDER BY created_at, id`,
          [scope.familyId, scope.profileId],
        );
        const entries = rows.rows.map(entryFromRow);
        const has = (kind: MedicalProfileEntryKind) => entries.some((entry) => entry.kind === kind);
        return {
          contractVersion: MEDICAL_PROFILE_CONTRACT_VERSION,
          profileId: scope.profileId,
          canWrite,
          entries,
          interpretationReady: has("sex") && has("birth_year"),
        };
      });
    },

    async createEntry(actor, requestedScope, requestedEntryId, input, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const entryId = canonicalEntryId(requestedEntryId);
      if (!kinds.has(input.kind)) throw new DomainValidationError();
      const value = medicalProfileEntryValue(input.kind, input.value);
      const date = recordedOn(input.recordedOn);
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const existing = (
          await client.query<EntryRow>(`${entrySelect} WHERE family_id = $1 AND id = $2`, [
            scope.familyId,
            entryId,
          ])
        ).rows[0];
        if (existing !== undefined) {
          const same =
            existing.kind === input.kind &&
            existing.value === value &&
            existing.recorded_on === date &&
            existing.revision === 1 &&
            existing.archived_at === null;
          if (!same) throw new DomainConflictError();
          const owned = await loadEntry(client, scope, entryId);
          return { response: response(scope, owned), created: false };
        }
        const total = await client.query<{ value: number }>(
          `SELECT count(*) AS value FROM medical_profile_entries
            WHERE family_id = $1 AND patient_profile_id = $2 AND archived_at IS NULL`,
          [scope.familyId, scope.profileId],
        );
        if ((total.rows[0]?.value ?? 0) >= MAX_MEDICAL_PROFILE_ENTRIES)
          throw new DomainConflictError();
        if (singletonKinds.has(input.kind)) {
          const active = await client.query<{ value: number }>(
            `SELECT count(*) AS value FROM medical_profile_entries
              WHERE family_id = $1 AND patient_profile_id = $2 AND kind = $3 AND archived_at IS NULL`,
            [scope.familyId, scope.profileId, input.kind],
          );
          if ((active.rows[0]?.value ?? 0) > 0) throw new DomainConflictError();
        }
        const now = new Date();
        await client.query(
          `INSERT INTO medical_profile_entries
             (id, family_id, patient_profile_id, kind, value, recorded_on, revision,
              created_by_user_id, created_at, updated_at, archived_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $8, NULL)`,
          [entryId, scope.familyId, scope.profileId, input.kind, value, date, actor.userId, now],
        );
        await audit(client, {
          actor,
          scope,
          action: "profile.medical_profile.entry_created",
          entryId,
          correlationId,
          now,
        });
        return {
          response: response(scope, await loadEntry(client, scope, entryId)),
          created: true,
        };
      });
    },

    async updateEntry(actor, requestedScope, requestedEntryId, input, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const entryId = canonicalEntryId(requestedEntryId);
      const date = recordedOn(input.recordedOn);
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const existing = await loadEntry(client, scope, entryId);
        if (existing.archived_at !== null) throw new ResourceNotFoundError();
        if (existing.revision !== input.revision) throw new DomainConflictError();
        const value = medicalProfileEntryValue(
          existing.kind as MedicalProfileEntryKind,
          input.value,
        );
        const now = new Date();
        await client.query(
          `UPDATE medical_profile_entries
              SET value = $4, recorded_on = $5, revision = revision + 1, updated_at = $6
            WHERE family_id = $1 AND patient_profile_id = $2 AND id = $3 AND revision = $7`,
          [scope.familyId, scope.profileId, entryId, value, date, now, input.revision],
        );
        await audit(client, {
          actor,
          scope,
          action: "profile.medical_profile.entry_updated",
          entryId,
          correlationId,
          now,
        });
        return response(scope, await loadEntry(client, scope, entryId));
      });
    },

    async archiveEntry(actor, requestedScope, requestedEntryId, input, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const entryId = canonicalEntryId(requestedEntryId);
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const existing = await loadEntry(client, scope, entryId);
        if (existing.archived_at !== null) return response(scope, existing);
        if (existing.revision !== input.revision) throw new DomainConflictError();
        const now = new Date();
        await client.query(
          `UPDATE medical_profile_entries
              SET archived_at = $4, revision = revision + 1, updated_at = $4
            WHERE family_id = $1 AND patient_profile_id = $2 AND id = $3 AND revision = $5`,
          [scope.familyId, scope.profileId, entryId, now, input.revision],
        );
        await audit(client, {
          actor,
          scope,
          action: "profile.medical_profile.entry_archived",
          entryId,
          correlationId,
          now,
        });
        return response(scope, await loadEntry(client, scope, entryId));
      });
    },
  };
}
