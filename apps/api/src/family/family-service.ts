import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AUDIT_LOG_CONTRACT_VERSION,
  type DemoInvitationAcceptRequest,
  type DemoInvitationAcceptResponse,
  type DemoRegistrationRequest,
  type DemoRegistrationResponse,
  FAMILY_INVITATION_CONTRACT_VERSION,
  FAMILY_PROFILE_CONTRACT_VERSION,
  type FamilyAuditLogResponse,
  type FamilyInvitationCreateResponse,
  type FamilyRole,
  type FamilySummary,
  type PatientProfileKind,
  type PatientProfileSummary,
  type SessionResponse,
} from "@veylta/contracts";
import {
  type Database,
  type DatabaseClient,
  isSqliteConstraintError,
  type QueryResult,
} from "../database/pool.js";

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

export interface DemoInvitationAcceptResult {
  response: DemoInvitationAcceptResponse;
  cookie: string;
}

export interface FamilyAuditLogQuery {
  limit?: string;
  cursor?: string;
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
  createInvitation(
    actor: SessionActor,
    familyId: string,
    correlationId: string,
  ): Promise<FamilyInvitationCreateResponse>;
  acceptDemoInvitation(
    input: DemoInvitationAcceptRequest,
    correlationId: string,
  ): Promise<DemoInvitationAcceptResult>;
  getSession(actor: SessionActor): Promise<SessionResponse>;
  getAuditLog(
    actor: SessionActor,
    familyId: string,
    query: FamilyAuditLogQuery,
    correlationId: string,
  ): Promise<FamilyAuditLogResponse>;
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
  created_at: string;
}

interface ProfileRow {
  id: string;
  family_id: string;
  display_name: string;
  kind: PatientProfileKind;
  created_at: string;
}

interface AuditLogRow {
  id: string;
  action: string;
  result: "success" | "denied" | "failed";
  resource_type: string;
  resource_id: string;
  created_at: string;
  actor_user_id: string;
  actor_display_name: string;
}

interface AuditLogCursor {
  id: string;
  occurredAt: string;
}

interface InvitationRow {
  id: string;
  family_id: string;
  role: "adult_member";
  expires_at: string;
}

interface Queryable {
  query<T extends object>(queryText: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const auditCursorPattern = /^[A-Za-z0-9_-]{1,500}$/;
const auditFieldPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/;
const defaultAuditLogPageSize = 50;
const invitationCodePattern = /^vi_[A-Za-z0-9_-]{43}$/;
const invitationTtlMs = 24 * 60 * 60 * 1_000;

function auditLogLimit(value: string | undefined): number {
  if (value === undefined) return defaultAuditLogPageSize;
  if (!/^(?:[1-9][0-9]?|100)$/.test(value)) throw new DomainValidationError();
  return Number(value);
}

function auditTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new DomainValidationError();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new DomainValidationError();
  }
  return value;
}

function decodeAuditLogCursor(value: string | undefined): AuditLogCursor | null {
  if (value === undefined) return null;
  if (!auditCursorPattern.test(value)) throw new DomainValidationError();
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("Non-canonical cursor");
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid cursor object");
    }
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "id,t,v" || record.v !== 1) {
      throw new Error("Invalid cursor shape");
    }
    if (typeof record.id !== "string" || !canonicalUuidPattern.test(record.id)) {
      throw new Error("Invalid cursor id");
    }
    return { id: record.id, occurredAt: auditTimestamp(record.t) };
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    throw new DomainValidationError();
  }
}

function encodeAuditLogCursor(cursor: AuditLogCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 1, t: cursor.occurredAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

function auditLogItem(row: AuditLogRow) {
  if (
    !canonicalUuidPattern.test(row.id) ||
    !canonicalUuidPattern.test(row.actor_user_id) ||
    !auditFieldPattern.test(row.action) ||
    !auditFieldPattern.test(row.resource_type) ||
    row.resource_id.length === 0 ||
    row.resource_id.length > 200 ||
    !["success", "denied", "failed"].includes(row.result) ||
    row.actor_display_name.length === 0 ||
    row.actor_display_name.length > 120
  ) {
    throw new DomainValidationError();
  }
  return {
    id: row.id,
    action: row.action,
    result: row.result,
    occurredAt: auditTimestamp(row.created_at),
    actor: { id: row.actor_user_id, displayName: row.actor_display_name },
    resource: { type: row.resource_type, id: row.resource_id },
  };
}

function profileSummary(row: ProfileRow): PatientProfileSummary {
  return {
    id: row.id,
    familyId: row.family_id,
    displayName: row.display_name,
    kind: row.kind,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function inTransaction<T>(
  database: Database,
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  return database.transaction(operation);
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
    contractVersion?: string;
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
      { contractVersion: event.contractVersion ?? FAMILY_PROFILE_CONTRACT_VERSION },
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
       AND status = 'active'`,
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

async function profilesForLinkedUser(
  client: Queryable,
  familyId: string,
  userId: string,
): Promise<PatientProfileSummary[]> {
  const result = await client.query<ProfileRow>(
    `SELECT id, family_id, display_name, kind, created_at
       FROM patient_profiles
      WHERE family_id = $1 AND linked_user_id = $2 AND archived_at IS NULL
      ORDER BY created_at, id`,
    [familyId, userId],
  );
  return result.rows.map(profileSummary);
}

export function createFamilyService(
  database: Database,
  options: FamilyServiceOptions,
): FamilyService {
  function sessionCookie(token: string, expiresAt: Date): string {
    const secure = options.secureCookie ? "; Secure" : "";
    return `${options.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${options.sessionTtlSeconds}; Expires=${expiresAt.toUTCString()}${secure}`;
  }

  return {
    async authenticate(cookieHeader) {
      const token = cookieValue(cookieHeader, options.cookieName);
      if (token === null || token.length < 32 || token.length > 128) return null;
      const tokenHash = sha256(token);
      const result = await database.query<{ user_id: string; display_name: string }>(
        `SELECT s.user_id, u.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > $2
           AND u.disabled_at IS NULL`,
        [tokenHash, new Date()],
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
      const created = await inTransaction(database, async (client) => {
        await requireOwner(client, actor, familyId);
        const row: ProfileRow = {
          id: randomUUID(),
          family_id: familyId,
          display_name: displayName,
          kind: input.kind,
          created_at: now.toISOString(),
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

    async createInvitation(actor, familyId, correlationId) {
      const normalizedFamilyId = familyId.toLowerCase();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + invitationTtlMs);
      const code = `vi_${randomBytes(32).toString("base64url")}`;
      const invitation = {
        id: randomUUID(),
        familyId: normalizedFamilyId,
        role: "adult_member" as const,
        expiresAt: expiresAt.toISOString(),
      };
      await inTransaction(database, async (client) => {
        await requireOwner(client, actor, normalizedFamilyId);
        await client.query(
          `INSERT INTO family_invitations
             (id, family_id, issued_by_user_id, token_hash, role, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            invitation.id,
            invitation.familyId,
            actor.userId,
            sha256(code),
            invitation.role,
            invitation.expiresAt,
            now,
          ],
        );
        await audit(client, {
          familyId: invitation.familyId,
          actorUserId: actor.userId,
          action: "family.invitation.created",
          resourceType: "FamilyInvitation",
          resourceId: invitation.id,
          correlationId,
          createdAt: now,
          contractVersion: FAMILY_INVITATION_CONTRACT_VERSION,
        });
      });
      return {
        contractVersion: FAMILY_INVITATION_CONTRACT_VERSION,
        invitation: { ...invitation, code },
      };
    },

    async acceptDemoInvitation(input, correlationId) {
      const code = input.code.trim();
      const displayName = input.displayName.trim();
      const profileName = input.profileName.trim();
      if (
        !invitationCodePattern.test(code) ||
        [displayName, profileName].some((value) => value.length === 0)
      ) {
        throw new DomainValidationError();
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + options.sessionTtlSeconds * 1_000);
      const token = randomBytes(32).toString("base64url");
      const ids = {
        user: randomUUID(),
        membership: randomUUID(),
        profile: randomUUID(),
        session: randomUUID(),
      };
      const result = await inTransaction(database, async (client) => {
        const invitation = (
          await client.query<InvitationRow>(
            `SELECT id, family_id, role, expires_at
               FROM family_invitations
              WHERE token_hash = $1
                AND accepted_at IS NULL
                AND expires_at > $2`,
            [sha256(code), now],
          )
        ).rows[0];
        if (invitation === undefined) throw new ResourceNotFoundError();

        await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
          ids.user,
          displayName,
          now,
        ]);
        await client.query(
          `INSERT INTO family_memberships
             (id, family_id, user_id, role, status, created_at)
           VALUES ($1, $2, $3, $4, 'active', $5)`,
          [ids.membership, invitation.family_id, ids.user, invitation.role, now],
        );
        await client.query(
          `INSERT INTO patient_profiles
             (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
           VALUES ($1, $2, $3, 'adult', $4, $4, $5)`,
          [ids.profile, invitation.family_id, profileName, ids.user, now],
        );
        const consumed = await client.query(
          `UPDATE family_invitations
              SET accepted_by_user_id = $1, accepted_at = $2
            WHERE id = $3
              AND accepted_at IS NULL`,
          [ids.user, now, invitation.id],
        );
        if (consumed.rowCount !== 1) throw new ResourceNotFoundError();
        await client.query(
          `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [ids.session, ids.user, sha256(token), expiresAt, now],
        );
        await audit(client, {
          familyId: invitation.family_id,
          actorUserId: ids.user,
          action: "family.invitation.accepted",
          resourceType: "FamilyInvitation",
          resourceId: invitation.id,
          correlationId,
          createdAt: now,
          contractVersion: FAMILY_INVITATION_CONTRACT_VERSION,
        });
        const family = (
          await client.query<{ id: string; display_name: string; created_at: string }>(
            `SELECT id, display_name, created_at
               FROM families
              WHERE id = $1`,
            [invitation.family_id],
          )
        ).rows[0];
        if (family === undefined) throw new ResourceNotFoundError();
        return family;
      });
      const family: FamilySummary = {
        id: result.id,
        displayName: result.display_name,
        role: "adult_member",
        createdAt: new Date(result.created_at).toISOString(),
      };
      const profile: PatientProfileSummary = {
        id: ids.profile,
        familyId: result.id,
        displayName: profileName,
        kind: "adult",
        createdAt: now.toISOString(),
      };
      return {
        response: { contractVersion: FAMILY_INVITATION_CONTRACT_VERSION, family, profile },
        cookie: sessionCookie(token, expiresAt),
      };
    },

    async getSession(actor) {
      return inTransaction(database, async (client) => {
        const memberships = await client.query<MembershipRow>(
          `SELECT f.id, f.display_name, m.role, f.created_at
           FROM family_memberships m
           JOIN families f ON f.id = m.family_id
           WHERE m.user_id = $1 AND m.status = 'active'
           ORDER BY f.created_at, f.id`,
          [actor.userId],
        );
        const families = [];
        for (const row of memberships.rows) {
          families.push({
            id: row.id,
            displayName: row.display_name,
            role: row.role,
            createdAt: new Date(row.created_at).toISOString(),
            profiles:
              row.role === "owner"
                ? await profilesFor(client, row.id)
                : row.role === "adult_member"
                  ? await profilesForLinkedUser(client, row.id, actor.userId)
                  : [],
          });
        }
        return {
          contractVersion: FAMILY_PROFILE_CONTRACT_VERSION,
          user: { id: actor.userId, displayName: actor.displayName },
          families,
        };
      });
    },

    async getAuditLog(actor, familyId, query, correlationId) {
      const normalizedFamilyId = familyId.toLowerCase();
      const limit = auditLogLimit(query.limit);
      return inTransaction(database, async (client) => {
        await requireOwner(client, actor, normalizedFamilyId);
        const cursor = decodeAuditLogCursor(query.cursor);
        const result = await client.query<AuditLogRow>(
          `SELECT e.id, e.action, e.result, e.resource_type, e.resource_id, e.created_at,
                  e.actor_user_id, u.display_name AS actor_display_name
             FROM audit_events e
             JOIN users u ON u.id = e.actor_user_id
            WHERE e.family_id = $1
              AND (
                $2 IS NULL
                OR e.created_at < $2
                OR (e.created_at = $2 AND e.id < $3)
              )
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT $4`,
          [normalizedFamilyId, cursor?.occurredAt ?? null, cursor?.id ?? null, limit + 1],
        );
        const items = result.rows.slice(0, limit).map(auditLogItem);
        const last = items.at(-1);
        const response: FamilyAuditLogResponse = {
          contractVersion: AUDIT_LOG_CONTRACT_VERSION,
          items,
          nextCursor:
            result.rows.length > limit && last !== undefined
              ? encodeAuditLogCursor({ id: last.id, occurredAt: last.occurredAt })
              : null,
        };
        await audit(client, {
          familyId: normalizedFamilyId,
          actorUserId: actor.userId,
          action: "family.audit_log.opened",
          resourceType: "Family",
          resourceId: normalizedFamilyId,
          correlationId,
          createdAt: new Date(),
          contractVersion: AUDIT_LOG_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async listProfiles(actor, familyId) {
      return inTransaction(database, async (client) => {
        const memberships = await client.query<{ role: FamilyRole }>(
          `SELECT role
             FROM family_memberships
            WHERE family_id = $1 AND user_id = $2 AND status = 'active'`,
          [familyId, actor.userId],
        );
        const role = memberships.rows[0]?.role;
        if (role === "owner") return profilesFor(client, familyId);
        if (role === "adult_member") return profilesForLinkedUser(client, familyId, actor.userId);
        throw new ResourceNotFoundError();
      });
    },

    async logout(actor, correlationId) {
      await inTransaction(database, async (client) => {
        const revokedAt = new Date();
        const revoked = await client.query<{ user_id: string }>(
          `UPDATE sessions
           SET revoked_at = $1
           WHERE token_hash = $2 AND revoked_at IS NULL
           RETURNING user_id`,
          [revokedAt, actor.tokenHash],
        );
        if (revoked.rows[0] === undefined) return;
        await audit(client, {
          familyId: null,
          actorUserId: actor.userId,
          action: "session.revoked",
          resourceType: "User",
          resourceId: actor.userId,
          correlationId,
          createdAt: revokedAt,
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
        await inTransaction(database, async (client) => {
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
        if (isSqliteConstraintError(error, "unique")) {
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
