import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type ArchivedProfileListResponse,
  type ArchivedProfileSummary,
  AUDIT_LOG_CONTRACT_VERSION,
  type DemoInvitationAcceptRequest,
  type DemoInvitationAcceptResponse,
  type DemoRegistrationRequest,
  type DemoRegistrationResponse,
  FAMILY_INVITATION_CONTRACT_VERSION,
  FAMILY_PROFILE_CONTRACT_VERSION,
  type FamilyAuditLogResponse,
  type FamilyConsentMember,
  type FamilyConsentMemberListResponse,
  type FamilyInvitationCreateRequest,
  type FamilyInvitationCreateResponse,
  type FamilyInvitationRole,
  type FamilyRole,
  type FamilySummary,
  type PatientProfileAccess,
  type PatientProfileKind,
  type PatientProfileSummary,
  PROFILE_ARCHIVE_CONTRACT_VERSION,
  PROFILE_CONSENT_CONTRACT_VERSION,
  type ProfileArchiveResponse,
  type ProfileConsentGrant,
  type ProfileConsentGrantCreateResponse,
  type ProfileConsentGrantListResponse,
  type ProfileRestoreResponse,
  type SessionResponse,
} from "@veylta/contracts";
import { type Database, type DatabaseClient, isSqliteConstraintError } from "../database/pool.js";
import { cookieValue } from "./cookie-header.js";
import { createPatientProfile, provisionalHandleSql } from "./patient-profiles.js";

export class ResourceNotFoundError extends Error {}
export class DomainConflictError extends Error {}
export class DomainValidationError extends Error {}

export interface SessionActor {
  userId: string;
  username: string | null;
  displayName: string;
  accountRole: "admin" | "user" | null;
  tokenHash: string;
}

export interface FamilyServiceOptions {
  cookieName: string;
  secureCookie: boolean;
  sessionTtlSeconds: number;
}

/** An entry that opens a session answers with the response and the cookie that carries it. */
export interface SessionResult<T> {
  response: T;
  cookie: string;
}

export type DemoRegistrationResult = SessionResult<DemoRegistrationResponse>;
export type DemoInvitationAcceptResult = SessionResult<DemoInvitationAcceptResponse>;

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
  archiveProfile(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    correlationId: string,
  ): Promise<ProfileArchiveResponse>;
  createInvitation(
    actor: SessionActor,
    familyId: string,
    input: FamilyInvitationCreateRequest,
    correlationId: string,
  ): Promise<FamilyInvitationCreateResponse>;
  createProfileConsentGrant(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    input: { granteeUserId: string; capability: "profile.read" },
    correlationId: string,
  ): Promise<ProfileConsentGrantCreateResponse>;
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
  getArchivedProfiles(
    actor: SessionActor,
    familyId: string,
    correlationId: string,
  ): Promise<ArchivedProfileListResponse>;
  getProfileConsentGrants(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    correlationId: string,
  ): Promise<ProfileConsentGrantListResponse>;
  listConsentMembers(
    actor: SessionActor,
    familyId: string,
    correlationId: string,
  ): Promise<FamilyConsentMemberListResponse>;
  listProfiles(actor: SessionActor, familyId: string): Promise<PatientProfileSummary[]>;
  logout(actor: SessionActor, correlationId: string): Promise<void>;
  registerDemo(
    input: DemoRegistrationRequest,
    correlationId: string,
  ): Promise<DemoRegistrationResult>;
  revokeProfileConsentGrant(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; grantId: string },
    correlationId: string,
  ): Promise<void>;
  restoreProfile(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    correlationId: string,
  ): Promise<ProfileRestoreResponse>;
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
  handle: string;
  kind: PatientProfileKind;
  access: PatientProfileAccess;
  created_at: string;
}

interface ArchivedProfileRow {
  id: string;
  family_id: string;
  display_name: string;
  kind: PatientProfileKind;
  archived_at: string;
}

interface ConsentMemberRow {
  id: string;
  display_name: string;
  role: FamilyInvitationRole;
}

interface ConsentGrantRow extends ConsentMemberRow {
  grant_id: string;
  family_id: string;
  patient_profile_id: string;
  capability: "profile.read";
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
  role: FamilyInvitationRole;
  expires_at: string;
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
    handle: row.handle,
    kind: row.kind,
    access: row.access,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function archivedProfileSummary(row: ArchivedProfileRow): ArchivedProfileSummary {
  return {
    id: row.id,
    familyId: row.family_id,
    displayName: row.display_name,
    kind: row.kind,
    archivedAt: new Date(row.archived_at).toISOString(),
  };
}

function consentMember(row: ConsentMemberRow): FamilyConsentMember {
  return { id: row.id, displayName: row.display_name, role: row.role };
}

function consentGrant(row: ConsentGrantRow): ProfileConsentGrant {
  return {
    id: row.grant_id,
    familyId: row.family_id,
    profileId: row.patient_profile_id,
    capability: row.capability,
    grantee: consentMember(row),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function audit(
  client: DatabaseClient,
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
  client: DatabaseClient,
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

async function profilesFor(
  client: DatabaseClient,
  familyId: string,
  userId: string,
): Promise<PatientProfileSummary[]> {
  const result = await client.query<ProfileRow>(
    `SELECT id, family_id, display_name, kind, 'owner' AS access, created_at,
            COALESCE(handle, ${provisionalHandleSql()}) AS handle
     FROM patient_profiles
     WHERE family_id = $1 AND archived_at IS NULL
     ORDER BY CASE WHEN linked_user_id = $2 THEN 0 ELSE 1 END, created_at, id`,
    [familyId, userId],
  );
  return result.rows.map(profileSummary);
}

async function profilesForGrantedUser(
  client: DatabaseClient,
  familyId: string,
  userId: string,
): Promise<PatientProfileSummary[]> {
  const result = await client.query<ProfileRow>(
    `SELECT p.id,
            p.family_id,
            p.display_name,
            p.kind,
            CASE WHEN p.linked_user_id = $2 THEN 'self' ELSE 'granted_read' END AS access,
            p.created_at,
            COALESCE(p.handle, ${provisionalHandleSql("p.")}) AS handle
       FROM patient_profiles p
       LEFT JOIN profile_consent_grants g
         ON g.family_id = p.family_id
        AND g.patient_profile_id = p.id
        AND g.grantee_user_id = $2
        AND g.capability = 'profile.read'
        AND g.revoked_at IS NULL
      WHERE p.family_id = $1
        AND p.archived_at IS NULL
        AND (p.linked_user_id = $2 OR g.id IS NOT NULL)
      ORDER BY p.created_at, p.id`,
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
      const result = await database.query<{
        user_id: string;
        username: string | null;
        display_name: string;
        account_role: "admin" | "user" | null;
      }>(
        `SELECT s.user_id, u.display_name, a.username, a.role AS account_role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN app_accounts a ON a.user_id = u.id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > $2
           AND u.disabled_at IS NULL`,
        [tokenHash, new Date()],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : {
            userId: row.user_id,
            username: row.username,
            displayName: row.display_name,
            accountRole: row.account_role,
            tokenHash,
          };
    },

    clearSessionCookie() {
      const secure = options.secureCookie ? "; Secure" : "";
      return `${options.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
    },

    async createProfile(actor, familyId, input, correlationId) {
      const displayName = input.displayName.trim();
      if (displayName.length === 0) throw new DomainValidationError();
      const now = new Date();
      const created = await database.transaction(async (client) => {
        await requireOwner(client, actor, familyId);
        const row: Omit<ProfileRow, "handle"> = {
          id: randomUUID(),
          family_id: familyId,
          display_name: displayName,
          kind: input.kind,
          access: "owner",
          created_at: now.toISOString(),
        };
        const handle = await createPatientProfile(client, {
          id: row.id,
          familyId,
          displayName: row.display_name,
          kind: row.kind,
          linkedUserId: null,
          createdByUserId: actor.userId,
          createdAt: row.created_at,
          username: null,
        });
        await audit(client, {
          familyId,
          actorUserId: actor.userId,
          action: "profile.created",
          resourceType: "PatientProfile",
          resourceId: row.id,
          correlationId,
          createdAt: now,
        });
        return { ...row, handle };
      });
      return profileSummary(created);
    },

    async archiveProfile(actor, requestedScope, correlationId) {
      const scope = {
        familyId: requestedScope.familyId.toLowerCase(),
        profileId: requestedScope.profileId.toLowerCase(),
      };
      const now = new Date();
      return database.transaction(async (client) => {
        await requireOwner(client, actor, scope.familyId);
        const target = await client.query<{ id: string }>(
          `SELECT id
             FROM patient_profiles
            WHERE family_id = $1 AND id = $2 AND archived_at IS NULL`,
          [scope.familyId, scope.profileId],
        );
        if (target.rows[0] === undefined) throw new ResourceNotFoundError();
        const active = await client.query<{ count: number }>(
          `SELECT count(*) AS count
             FROM patient_profiles
            WHERE family_id = $1 AND archived_at IS NULL`,
          [scope.familyId],
        );
        if (Number(active.rows[0]?.count) <= 1) {
          throw new DomainConflictError("The last active profile cannot be archived");
        }
        const archived = await client.query<{ id: string; archived_at: string }>(
          `UPDATE patient_profiles
              SET archived_at = $1
            WHERE family_id = $2 AND id = $3 AND archived_at IS NULL
          RETURNING id, archived_at`,
          [now, scope.familyId, scope.profileId],
        );
        const row = archived.rows[0];
        if (row === undefined) throw new ResourceNotFoundError();
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.archived",
          resourceType: "PatientProfile",
          resourceId: row.id,
          correlationId,
          createdAt: now,
          contractVersion: PROFILE_ARCHIVE_CONTRACT_VERSION,
        });
        return {
          contractVersion: PROFILE_ARCHIVE_CONTRACT_VERSION,
          profileId: row.id,
          archivedAt: new Date(row.archived_at).toISOString(),
        };
      });
    },

    async createInvitation(actor, familyId, input, correlationId) {
      const normalizedFamilyId = familyId.toLowerCase();
      if (input.role !== "adult_member" && input.role !== "caregiver") {
        throw new DomainValidationError();
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + invitationTtlMs);
      const code = `vi_${randomBytes(32).toString("base64url")}`;
      const invitation = {
        id: randomUUID(),
        familyId: normalizedFamilyId,
        role: input.role,
        expiresAt: expiresAt.toISOString(),
      };
      await database.transaction(async (client) => {
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

    async createProfileConsentGrant(actor, requestedScope, input, correlationId) {
      const scope = {
        familyId: requestedScope.familyId.toLowerCase(),
        profileId: requestedScope.profileId.toLowerCase(),
      };
      const granteeUserId = input.granteeUserId.toLowerCase();
      const now = new Date();
      const grantId = randomUUID();
      try {
        const grant = await database.transaction(async (client) => {
          await requireOwner(client, actor, scope.familyId);
          const profile = await client.query<{ id: string }>(
            `SELECT id
               FROM patient_profiles
              WHERE family_id = $1 AND id = $2 AND archived_at IS NULL`,
            [scope.familyId, scope.profileId],
          );
          if (profile.rows[0] === undefined) throw new ResourceNotFoundError();
          const grantee = (
            await client.query<ConsentMemberRow>(
              `SELECT u.id, u.display_name, m.role
                 FROM family_memberships m
                 JOIN users u ON u.id = m.user_id
                WHERE m.family_id = $1
                  AND m.user_id = $2
                  AND m.role IN ('adult_member', 'caregiver')
                  AND m.status = 'active'
                  AND u.disabled_at IS NULL`,
              [scope.familyId, granteeUserId],
            )
          ).rows[0];
          if (grantee === undefined) throw new ResourceNotFoundError();
          await client.query(
            `INSERT INTO profile_consent_grants
               (id, family_id, patient_profile_id, grantee_user_id, granted_by_user_id,
                capability, created_at)
             VALUES ($1, $2, $3, $4, $5, 'profile.read', $6)`,
            [grantId, scope.familyId, scope.profileId, grantee.id, actor.userId, now],
          );
          const created: ConsentGrantRow = {
            grant_id: grantId,
            family_id: scope.familyId,
            patient_profile_id: scope.profileId,
            capability: "profile.read",
            created_at: now.toISOString(),
            ...grantee,
          };
          await audit(client, {
            familyId: scope.familyId,
            actorUserId: actor.userId,
            action: "profile.consent_granted",
            resourceType: "ProfileConsentGrant",
            resourceId: grantId,
            correlationId,
            createdAt: now,
            contractVersion: PROFILE_CONSENT_CONTRACT_VERSION,
          });
          return consentGrant(created);
        });
        return { contractVersion: PROFILE_CONSENT_CONTRACT_VERSION, grant };
      } catch (error) {
        if (isSqliteConstraintError(error, "unique")) throw new DomainConflictError();
        throw error;
      }
    },

    async acceptDemoInvitation(input, correlationId) {
      const code = input.code.trim();
      const displayName = input.displayName.trim();
      const profileName = input.profileName === undefined ? undefined : input.profileName.trim();
      if (
        !invitationCodePattern.test(code) ||
        displayName.length === 0 ||
        (profileName !== undefined && profileName.length === 0)
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
      const result = await database.transaction(async (client) => {
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
        if (
          (invitation.role === "adult_member" && profileName === undefined) ||
          (invitation.role === "caregiver" && profileName !== undefined)
        ) {
          throw new DomainValidationError();
        }

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
        const profileHandle =
          invitation.role === "adult_member"
            ? await createPatientProfile(client, {
                id: ids.profile,
                familyId: invitation.family_id,
                displayName: profileName ?? "",
                kind: "adult",
                linkedUserId: ids.user,
                createdByUserId: ids.user,
                createdAt: now.toISOString(),
                username: null,
              })
            : null;
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
        return { family, role: invitation.role, profileHandle };
      });
      if (result.family === undefined) throw new ResourceNotFoundError();
      const family: FamilySummary = {
        id: result.family.id,
        displayName: result.family.display_name,
        role: result.role,
        createdAt: new Date(result.family.created_at).toISOString(),
      };
      const profile: PatientProfileSummary | null =
        result.role === "adult_member" && result.profileHandle !== null
          ? {
              id: ids.profile,
              familyId: result.family.id,
              displayName: profileName ?? "",
              handle: result.profileHandle,
              kind: "adult",
              access: "self",
              createdAt: now.toISOString(),
            }
          : null;
      return {
        response: { contractVersion: FAMILY_INVITATION_CONTRACT_VERSION, family, profile },
        cookie: sessionCookie(token, expiresAt),
      };
    },

    async getSession(actor) {
      return database.transaction(async (client) => {
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
                ? await profilesFor(client, row.id, actor.userId)
                : row.role === "adult_member" || row.role === "caregiver"
                  ? await profilesForGrantedUser(client, row.id, actor.userId)
                  : [],
          });
        }
        return {
          contractVersion: FAMILY_PROFILE_CONTRACT_VERSION,
          user: {
            id: actor.userId,
            username: actor.username,
            displayName: actor.displayName,
            role: actor.accountRole,
          },
          families,
        };
      });
    },

    async getAuditLog(actor, familyId, query, correlationId) {
      const normalizedFamilyId = familyId.toLowerCase();
      const limit = auditLogLimit(query.limit);
      return database.transaction(async (client) => {
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

    async getArchivedProfiles(actor, familyId, correlationId) {
      const normalizedFamilyId = familyId.toLowerCase();
      return database.transaction(async (client) => {
        await requireOwner(client, actor, normalizedFamilyId);
        const profiles = await client.query<ArchivedProfileRow>(
          `SELECT id, family_id, display_name, kind, archived_at
             FROM patient_profiles
            WHERE family_id = $1 AND archived_at IS NOT NULL
            ORDER BY archived_at DESC, id DESC`,
          [normalizedFamilyId],
        );
        const response: ArchivedProfileListResponse = {
          contractVersion: PROFILE_ARCHIVE_CONTRACT_VERSION,
          items: profiles.rows.map(archivedProfileSummary),
        };
        await audit(client, {
          familyId: normalizedFamilyId,
          actorUserId: actor.userId,
          action: "family.archived_profiles.opened",
          resourceType: "Family",
          resourceId: normalizedFamilyId,
          correlationId,
          createdAt: new Date(),
          contractVersion: PROFILE_ARCHIVE_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async getProfileConsentGrants(actor, requestedScope, correlationId) {
      const scope = {
        familyId: requestedScope.familyId.toLowerCase(),
        profileId: requestedScope.profileId.toLowerCase(),
      };
      return database.transaction(async (client) => {
        await requireOwner(client, actor, scope.familyId);
        const profile = await client.query<{ id: string }>(
          `SELECT id
             FROM patient_profiles
            WHERE family_id = $1 AND id = $2 AND archived_at IS NULL`,
          [scope.familyId, scope.profileId],
        );
        if (profile.rows[0] === undefined) throw new ResourceNotFoundError();
        const grants = await client.query<ConsentGrantRow>(
          `SELECT g.id AS grant_id,
                  g.family_id,
                  g.patient_profile_id,
                  g.capability,
                  g.created_at,
                  u.id,
                  u.display_name,
                  m.role
             FROM profile_consent_grants g
             JOIN family_memberships m
               ON m.family_id = g.family_id
              AND m.user_id = g.grantee_user_id
             JOIN users u ON u.id = g.grantee_user_id
            WHERE g.family_id = $1
              AND g.patient_profile_id = $2
              AND g.revoked_at IS NULL
              AND m.role IN ('adult_member', 'caregiver')
              AND m.status = 'active'
              AND u.disabled_at IS NULL
            ORDER BY g.created_at, g.id`,
          [scope.familyId, scope.profileId],
        );
        const response: ProfileConsentGrantListResponse = {
          contractVersion: PROFILE_CONSENT_CONTRACT_VERSION,
          items: grants.rows.map(consentGrant),
        };
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.consent_grants.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: PROFILE_CONSENT_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async listConsentMembers(actor, familyId, correlationId) {
      const normalizedFamilyId = familyId.toLowerCase();
      return database.transaction(async (client) => {
        await requireOwner(client, actor, normalizedFamilyId);
        const members = await client.query<ConsentMemberRow>(
          `SELECT u.id, u.display_name, m.role
             FROM family_memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.family_id = $1
              AND m.role IN ('adult_member', 'caregiver')
              AND m.status = 'active'
              AND u.disabled_at IS NULL
            ORDER BY u.display_name, u.id`,
          [normalizedFamilyId],
        );
        const response: FamilyConsentMemberListResponse = {
          contractVersion: PROFILE_CONSENT_CONTRACT_VERSION,
          items: members.rows.map(consentMember),
        };
        await audit(client, {
          familyId: normalizedFamilyId,
          actorUserId: actor.userId,
          action: "profile.consent_members.opened",
          resourceType: "Family",
          resourceId: normalizedFamilyId,
          correlationId,
          createdAt: new Date(),
          contractVersion: PROFILE_CONSENT_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async listProfiles(actor, familyId) {
      return database.transaction(async (client) => {
        const memberships = await client.query<{ role: FamilyRole }>(
          `SELECT role
             FROM family_memberships
            WHERE family_id = $1 AND user_id = $2 AND status = 'active'`,
          [familyId, actor.userId],
        );
        const role = memberships.rows[0]?.role;
        if (role === "owner") return profilesFor(client, familyId, actor.userId);
        if (role === "adult_member" || role === "caregiver") {
          return profilesForGrantedUser(client, familyId, actor.userId);
        }
        throw new ResourceNotFoundError();
      });
    },

    async logout(actor, correlationId) {
      await database.transaction(async (client) => {
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

    async revokeProfileConsentGrant(actor, requestedScope, correlationId) {
      const scope = {
        familyId: requestedScope.familyId.toLowerCase(),
        profileId: requestedScope.profileId.toLowerCase(),
        grantId: requestedScope.grantId.toLowerCase(),
      };
      await database.transaction(async (client) => {
        await requireOwner(client, actor, scope.familyId);
        const now = new Date();
        const revoked = await client.query(
          `UPDATE profile_consent_grants
              SET revoked_at = $1
            WHERE id = $2
              AND family_id = $3
              AND patient_profile_id = $4
              AND revoked_at IS NULL`,
          [now, scope.grantId, scope.familyId, scope.profileId],
        );
        if (revoked.rowCount !== 1) throw new ResourceNotFoundError();
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.consent_revoked",
          resourceType: "ProfileConsentGrant",
          resourceId: scope.grantId,
          correlationId,
          createdAt: now,
          contractVersion: PROFILE_CONSENT_CONTRACT_VERSION,
        });
      });
    },

    async restoreProfile(actor, requestedScope, correlationId) {
      const scope = {
        familyId: requestedScope.familyId.toLowerCase(),
        profileId: requestedScope.profileId.toLowerCase(),
      };
      const now = new Date();
      try {
        return await database.transaction(async (client) => {
          await requireOwner(client, actor, scope.familyId);
          const restored = await client.query<{ id: string }>(
            `UPDATE patient_profiles
                SET archived_at = NULL
              WHERE family_id = $1 AND id = $2 AND archived_at IS NOT NULL
            RETURNING id`,
            [scope.familyId, scope.profileId],
          );
          const row = restored.rows[0];
          if (row === undefined) throw new ResourceNotFoundError();
          await audit(client, {
            familyId: scope.familyId,
            actorUserId: actor.userId,
            action: "profile.restored",
            resourceType: "PatientProfile",
            resourceId: row.id,
            correlationId,
            createdAt: now,
            contractVersion: PROFILE_ARCHIVE_CONTRACT_VERSION,
          });
          return {
            contractVersion: PROFILE_ARCHIVE_CONTRACT_VERSION,
            profileId: row.id,
            restoredAt: now.toISOString(),
          };
        });
      } catch (error) {
        if (isSqliteConstraintError(error, "unique")) {
          throw new DomainConflictError("The archived profile conflicts with an active profile");
        }
        throw error;
      }
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

      let profileHandle: string;
      try {
        profileHandle = await database.transaction(async (client) => {
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
          const handle = await createPatientProfile(client, {
            id: ids.profile,
            familyId: ids.family,
            displayName: profileName,
            kind: "adult",
            linkedUserId: ids.user,
            createdByUserId: ids.user,
            createdAt: now.toISOString(),
            username: null,
          });
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
          return handle;
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
        handle: profileHandle,
        kind: "adult",
        access: "owner",
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
