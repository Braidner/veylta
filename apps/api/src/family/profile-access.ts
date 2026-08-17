import type { DatabaseClient } from "../database/pool.js";
import {
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "./family-service.js";

export interface ProfileScope {
  readonly familyId: string;
  readonly profileId: string;
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Lower-cases both ids and refuses anything that is not a canonical v4 UUID. */
export function canonicalProfileScope(scope: ProfileScope): ProfileScope {
  const familyId = scope.familyId.toLowerCase();
  const profileId = scope.profileId.toLowerCase();
  if (!canonicalUuidPattern.test(familyId) || !canonicalUuidPattern.test(profileId)) {
    throw new DomainValidationError();
  }
  return { familyId, profileId };
}

/**
 * The one authorization rule for a profile-scoped surface: an active owner or the adult the
 * profile is linked to may write; an adult or caregiver with a live `profile.read` grant may
 * read; everyone else — and every archived or foreign profile — gets a non-disclosing 404.
 */
export async function profileAccess(
  client: Pick<DatabaseClient, "query">,
  actor: SessionActor,
  scope: ProfileScope,
): Promise<{ readonly canWrite: boolean }> {
  const result = await client.query<{ can_write: number }>(
    `SELECT CASE
              WHEN m.role = 'owner'
                OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
              THEN 1 ELSE 0
            END AS can_write
       FROM patient_profiles p
       JOIN family_memberships m
         ON m.family_id = p.family_id
        AND m.user_id = $3
        AND m.status = 'active'
      WHERE p.family_id = $1
        AND p.id = $2
        AND p.archived_at IS NULL
        AND (
          m.role = 'owner'
          OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
          OR (
            m.role IN ('adult_member', 'caregiver')
            AND EXISTS (
              SELECT 1
                FROM profile_consent_grants grant_access
               WHERE grant_access.family_id = p.family_id
                 AND grant_access.patient_profile_id = p.id
                 AND grant_access.grantee_user_id = m.user_id
                 AND grant_access.capability = 'profile.read'
                 AND grant_access.revoked_at IS NULL
            )
          )
        )`,
    [scope.familyId, scope.profileId, actor.userId],
  );
  const row = result.rows[0];
  if (row === undefined || ![0, 1].includes(row.can_write)) throw new ResourceNotFoundError();
  return { canWrite: row.can_write === 1 };
}

/** Like `profileAccess`, but a reader gets the same 404 as a stranger: the surface is write-only. */
export async function requireProfileWrite(
  client: Pick<DatabaseClient, "query">,
  actor: SessionActor,
  scope: ProfileScope,
): Promise<void> {
  const { canWrite } = await profileAccess(client, actor, scope);
  if (!canWrite) throw new ResourceNotFoundError();
}
