import { randomUUID } from "node:crypto";
import {
  FAMILY_PROFILE_CONTRACT_VERSION,
  isValidProfileHandle,
  type ProfileHandleResponse,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import { DomainConflictError, DomainValidationError, type SessionActor } from "./family-service.js";
import { canonicalProfileScope, type ProfileScope, requireProfileWrite } from "./profile-access.js";

/**
 * A person's own name for their page. Lower-cased before anything else; invalid or reserved is a
 * 422, taken by another profile (any case) a 409, a profile the session may not write a 404. The
 * same handle again changes nothing and writes no audit row.
 */
export async function setProfileHandle(
  database: Database,
  input: { actor: SessionActor; scope: ProfileScope; handle: string; correlationId: string },
): Promise<ProfileHandleResponse> {
  const scope = canonicalProfileScope(input.scope);
  const handle = input.handle.trim().toLowerCase();
  if (!isValidProfileHandle(handle)) throw new DomainValidationError();
  return database.transaction(async (client) => {
    await requireProfileWrite(client, input.actor, scope);
    const current = await client.query<{ handle: string }>(
      `SELECT handle FROM patient_profiles WHERE family_id = $1 AND id = $2`,
      [scope.familyId, scope.profileId],
    );
    if (current.rows[0]?.handle.toLowerCase() === handle) {
      return {
        contractVersion: FAMILY_PROFILE_CONTRACT_VERSION,
        profileId: scope.profileId,
        handle,
      };
    }
    const taken = await client.query<{ id: string }>(
      `SELECT id FROM patient_profiles WHERE handle = $1 COLLATE NOCASE AND id <> $2`,
      [handle, scope.profileId],
    );
    if (taken.rows.length > 0) throw new DomainConflictError();
    const now = new Date();
    await client.query(
      `UPDATE patient_profiles SET handle = $1, handle_set_by = 'person' WHERE family_id = $2 AND id = $3`,
      [handle, scope.familyId, scope.profileId],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, family_id, actor_user_id, action, resource_type, resource_id, result,
          correlation_id, metadata, created_at)
       VALUES ($1, $2, $3, 'profile.handle.changed', 'PatientProfile', $4, 'success', $5, $6, $7)`,
      [
        randomUUID(),
        scope.familyId,
        input.actor.userId,
        scope.profileId,
        input.correlationId,
        { contractVersion: FAMILY_PROFILE_CONTRACT_VERSION },
        now,
      ],
    );
    return { contractVersion: FAMILY_PROFILE_CONTRACT_VERSION, profileId: scope.profileId, handle };
  });
}
