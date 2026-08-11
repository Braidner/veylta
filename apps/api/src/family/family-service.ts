import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type DemoRegistrationRequest,
  type DemoRegistrationResponse,
  FAMILY_PROFILE_CONTRACT_VERSION,
  type FamilyRole,
  type FamilySummary,
  type PatientProfileKind,
  type PatientProfileSummary,
  type SessionResponse,
} from "@family-health/contracts";
import type { Pool, PoolClient, QueryResult } from "pg";

export class ResourceNotFoundError extends Error {}
export class DomainConflictError extends Error {}
export class DomainValidationError extends Error {}

export interface SessionActor {
  userId: string;
  displayName: string;
  tokenHash: string;
}

export interface FamilyServiceOptions {
  cookieName: string;
  secureCookie: boolean;
  sessionTtlSeconds: number;
}

export interface DemoRegistrationResult {
  response: DemoRegistrationResponse;
  cookie: string;
}

export interface FamilyService {
  authenticate(cookieHeader: string | undefined): Promise<SessionActor | null>;
  clearSessionCookie(): string;
  createProfile(
    actor: SessionActor,
    familyId: string,
    input: { displayName: string; kind: PatientProfileKind },
    correlationId: string,
  ): Promise<PatientProfileSummary>;
  getSession(actor: SessionActor): Promise<SessionResponse>;
  listProfiles(actor: SessionActor, familyId: string): Promise<PatientProfileSummary[]>;
  logout(actor: SessionActor, correlationId: string): Promise<void>;
  registerDemo(
    input: DemoRegistrationRequest,
    correlationId: string,
  ): Promise<DemoRegistrationResult>;
}

interface MembershipRow {
  id: string;
  display_name: string;
  role: FamilyRole;
  created_at: Date;
}

interface ProfileRow {
  id: string;
  family_id: string;
  display_name: string;
  kind: PatientProfileKind;
  created_at: Date;
}

interface Queryable {
  query<T extends object>(queryText: string, values?: unknown[]): Promise<QueryResult<T>>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function profileSummary(row: ProfileRow): PatientProfileSummary {
  return {
    id: row.id,
    familyId: row.family_id,
    displayName: row.display_name,
    kind: row.kind,
    createdAt: row.created_at.toISOString(),
  };
}

async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

async function audit(
  client: Queryable,
  event: {
    familyId: string | null;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    correlationId: string;
    createdAt: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'success', $7, $8, $9)`,
    [
      randomUUID(),
      event.familyId,
      event.actorUserId,
      event.action,
      event.resourceType,
      event.resourceId,
      event.correlationId,
      { contractVersion: FAMILY_PROFILE_CONTRACT_VERSION },
      event.createdAt,
    ],
  );
}

async function requireOwner(
  client: Queryable,
  actor: SessionActor,
  familyId: string,
): Promise<void> {
  const access = await client.query<{ role: FamilyRole }>(
    `SELECT role
     FROM family_memberships
     WHERE family_id = $1
       AND user_id = $2
       AND status = 'active'
     FOR SHARE`,
    [familyId, actor.userId],
  );
  if (access.rows[0]?.role !== "owner") throw new ResourceNotFoundError();
}

async function profilesFor(client: Queryable, familyId: string): Promise<PatientProfileSummary[]> {
  const result = await client.query<ProfileRow>(
    `SELECT id, family_id, display_name, kind, created_at
     FROM patient_profiles
     WHERE family_id = $1 AND archived_at IS NULL
     ORDER BY created_at, id`,
    [familyId],
  );
  return result.rows.map(profileSummary);
}

export function createFamilyService(pool: Pool, options: FamilyServiceOptions): FamilyService {
  function sessionCookie(token: string, expiresAt: Date): string {
    const secure = options.secureCookie ? "; Secure" : "";
    return `${options.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${options.sessionTtlSeconds}; Expires=${expiresAt.toUTCString()}${secure}`;
  }

  return {
    async authenticate(cookieHeader) {
      const token = cookieValue(cookieHeader, options.cookieName);
      if (token === null || token.length < 32 || token.length > 128) return null;
      const tokenHash = sha256(token);
      const result = await pool.query<{ user_id: string; display_name: string }>(
        `SELECT s.user_id, u.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND u.disabled_at IS NULL`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : { userId: row.user_id, displayName: row.display_name, tokenHash };
    },

    clearSessionCookie() {
      const secure = options.secureCookie ? "; Secure" : "";
      return `${options.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
    },

    async createProfile(actor, familyId, input, correlationId) {
      const displayName = input.displayName.trim();
      if (displayName.length === 0) throw new DomainValidationError();
      const now = new Date();
      const created = await inTransaction(pool, async (client) => {
        await requireOwner(client, actor, familyId);
        const row: ProfileRow = {
          id: randomUUID(),
          family_id: familyId,
          display_name: displayName,
          kind: input.kind,
          created_at: now,
        };
        await client.query(
          `INSERT INTO patient_profiles
             (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
           VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
          [row.id, row.family_id, row.display_name, row.kind, actor.userId, row.created_at],
        );
        await audit(client, {
          familyId,
          actorUserId: actor.userId,
          action: "profile.created",
          resourceType: "PatientProfile",
          resourceId: row.id,
          correlationId,
          createdAt: now,
        });
        return row;
      });
      return profileSummary(created);
    },

    async getSession(actor) {
      return inTransaction(pool, async (client) => {
        const memberships = await client.query<MembershipRow>(
          `SELECT f.id, f.display_name, m.role, f.created_at
           FROM family_memberships m
           JOIN families f ON f.id = m.family_id
           WHERE m.user_id = $1 AND m.status = 'active'
           ORDER BY f.created_at, f.id
           FOR SHARE OF m`,
          [actor.userId],
        );
        const families = [];
        for (const row of memberships.rows) {
          families.push({
            id: row.id,
            displayName: row.display_name,
            role: row.role,
            createdAt: row.created_at.toISOString(),
            profiles: row.role === "owner" ? await profilesFor(client, row.id) : [],
          });
        }
        return {
          contractVersion: FAMILY_PROFILE_CONTRACT_VERSION,
          user: { id: actor.userId, displayName: actor.displayName },
          families,
        };
      });
    },

    async listProfiles(actor, familyId) {
      return inTransaction(pool, async (client) => {
        await requireOwner(client, actor, familyId);
        return profilesFor(client, familyId);
      });
    },

    async logout(actor, correlationId) {
      await inTransaction(pool, async (client) => {
        const revoked = await client.query<{ user_id: string }>(
          `UPDATE sessions
           SET revoked_at = now()
           WHERE token_hash = $1 AND revoked_at IS NULL
           RETURNING user_id`,
          [actor.tokenHash],
        );
        if (revoked.rows[0] === undefined) return;
        await audit(client, {
          familyId: null,
          actorUserId: actor.userId,
          action: "session.revoked",
          resourceType: "User",
          resourceId: actor.userId,
          correlationId,
          createdAt: new Date(),
        });
      });
    },

    async registerDemo(input, correlationId) {
      const displayName = input.displayName.trim();
      const familyName = input.familyName.trim();
      const profileName = input.profileName.trim();
      if ([displayName, familyName, profileName].some((value) => value.length === 0)) {
        throw new DomainValidationError();
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + options.sessionTtlSeconds * 1_000);
      const token = randomBytes(32).toString("base64url");
      const ids = {
        user: randomUUID(),
        family: randomUUID(),
        membership: randomUUID(),
        profile: randomUUID(),
        session: randomUUID(),
      };

      try {
        await inTransaction(pool, async (client) => {
          await client.query(
            "INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)",
            [ids.user, displayName, now],
          );
          await client.query(
            `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [ids.session, ids.user, sha256(token), expiresAt, now],
          );
          await client.query(
            `INSERT INTO families (id, display_name, created_by_user_id, created_at)
             VALUES ($1, $2, $3, $4)`,
            [ids.family, familyName, ids.user, now],
          );
          await client.query(
            `INSERT INTO family_memberships
               (id, family_id, user_id, role, status, created_at)
             VALUES ($1, $2, $3, 'owner', 'active', $4)`,
            [ids.membership, ids.family, ids.user, now],
          );
          await client.query(
            `INSERT INTO patient_profiles
               (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
             VALUES ($1, $2, $3, 'adult', $4, $4, $5)`,
            [ids.profile, ids.family, profileName, ids.user, now],
          );
          await audit(client, {
            familyId: null,
            actorUserId: ids.user,
            action: "demo.session.created",
            resourceType: "User",
            resourceId: ids.user,
            correlationId,
            createdAt: now,
          });
          await audit(client, {
            familyId: ids.family,
            actorUserId: ids.user,
            action: "family.created",
            resourceType: "Family",
            resourceId: ids.family,
            correlationId,
            createdAt: now,
          });
          await audit(client, {
            familyId: ids.family,
            actorUserId: ids.user,
            action: "profile.created",
            resourceType: "PatientProfile",
            resourceId: ids.profile,
            correlationId,
            createdAt: now,
          });
        });
      } catch (error) {
        if (isPostgresError(error, "23505")) {
          throw new DomainConflictError("Demo registration collided with an existing resource");
        }
        throw error;
      }

      const family: FamilySummary = {
        id: ids.family,
        displayName: familyName,
        role: "owner",
        createdAt: now.toISOString(),
      };
      const profile: PatientProfileSummary = {
        id: ids.profile,
        familyId: ids.family,
        displayName: profileName,
        kind: "adult",
        createdAt: now.toISOString(),
      };
      return {
        response: {
          contractVersion: FAMILY_PROFILE_CONTRACT_VERSION,
          family,
          profile,
        },
        cookie: sessionCookie(token, expiresAt),
      };
    },
  };
}
