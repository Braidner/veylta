import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  ACCOUNT_CONTRACT_VERSION,
  type AdminSetupRequest,
  type AdminSetupResponse,
  type AppAccountUser,
  type LoginRequest,
  type LoginResponse,
  type SetupStatusResponse,
} from "@veylta/contracts";
import type { Database, DatabaseClient } from "../database/pool.js";
import { DomainConflictError } from "../family/family-service.js";
import { createPatientProfile } from "../family/patient-profiles.js";
import { isValidUsername, normalizeUsername, validateAccountFields } from "./account-fields.js";
import { hashPassword, verifyPassword } from "./password.js";

export class InvalidCredentialsError extends Error {}

export interface AccountServiceOptions {
  cookieName: string;
  secureCookie: boolean;
  sessionTtlSeconds: number;
}

export interface AuthenticatedAccountResult<T> {
  cookie: string;
  response: T;
}

export interface AccountService {
  getSetupStatus(): Promise<SetupStatusResponse>;
  login(
    input: LoginRequest,
    correlationId: string,
  ): Promise<AuthenticatedAccountResult<LoginResponse>>;
  setupAdmin(
    input: AdminSetupRequest,
    correlationId: string,
  ): Promise<AuthenticatedAccountResult<AdminSetupResponse>>;
}

const dummyPasswordHash = hashPassword(randomBytes(32).toString("base64url"));

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function insertAudit(
  client: DatabaseClient,
  input: {
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
      input.familyId,
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.correlationId,
      { contractVersion: ACCOUNT_CONTRACT_VERSION },
      input.createdAt,
    ],
  );
}

export function createAccountService(
  database: Database,
  options: AccountServiceOptions,
): AccountService {
  function issueSession() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + options.sessionTtlSeconds * 1_000);
    const token = randomBytes(32).toString("base64url");
    return { expiresAt, now, token, tokenHash: sha256(token), id: randomUUID() };
  }

  function sessionCookie(token: string, expiresAt: Date): string {
    const secure = options.secureCookie ? "; Secure" : "";
    return `${options.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${options.sessionTtlSeconds}; Expires=${expiresAt.toUTCString()}${secure}`;
  }

  return {
    async getSetupStatus() {
      const count = await database.query<{ count: number }>(
        "SELECT count(*) AS count FROM app_accounts",
      );
      return {
        contractVersion: ACCOUNT_CONTRACT_VERSION,
        setupRequired: Number(count.rows[0]?.count) === 0,
      };
    },

    async login(input, correlationId) {
      const username = normalizeUsername(input.username);
      const account = isValidUsername(username)
        ? (
            await database.query<{
              user_id: string;
              display_name: string;
              password_hash: string;
              role: "admin" | "user";
            }>(
              `SELECT a.user_id, a.password_hash, a.role, u.display_name
             FROM app_accounts a
             JOIN users u ON u.id = a.user_id
            WHERE a.username = $1 COLLATE NOCASE
              AND u.disabled_at IS NULL`,
              [username],
            )
          ).rows[0]
        : undefined;
      const passwordMatches = await verifyPassword(
        input.password,
        account?.password_hash ?? (await dummyPasswordHash),
      );
      if (account === undefined || !passwordMatches) {
        throw new InvalidCredentialsError();
      }
      const session = issueSession();
      await database.transaction(async (client) => {
        await client.query(
          `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [session.id, account.user_id, session.tokenHash, session.expiresAt, session.now],
        );
        await insertAudit(client, {
          familyId: null,
          actorUserId: account.user_id,
          action: "session.created",
          resourceType: "User",
          resourceId: account.user_id,
          correlationId,
          createdAt: session.now,
        });
      });
      const user: AppAccountUser = {
        id: account.user_id,
        username,
        displayName: account.display_name,
        role: account.role,
      };
      return {
        response: { contractVersion: ACCOUNT_CONTRACT_VERSION, user },
        cookie: sessionCookie(session.token, session.expiresAt),
      };
    },

    async setupAdmin(input, correlationId) {
      const username = normalizeUsername(input.username);
      const displayName = input.displayName.trim();
      validateAccountFields({ username, displayName, password: input.password });
      const existingAccounts = await database.query<{ count: number }>(
        "SELECT count(*) AS count FROM app_accounts",
      );
      if (Number(existingAccounts.rows[0]?.count) !== 0) throw new DomainConflictError();
      const passwordHash = await hashPassword(input.password);
      const session = issueSession();
      const ids = {
        user: randomUUID(),
        family: randomUUID(),
        membership: randomUUID(),
        profile: randomUUID(),
      };
      const handle = await database.transaction(async (client) => {
        const accounts = await client.query<{ count: number }>(
          "SELECT count(*) AS count FROM app_accounts",
        );
        if (Number(accounts.rows[0]?.count) !== 0) throw new DomainConflictError();
        await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
          ids.user,
          displayName,
          session.now,
        ]);
        await client.query(
          `INSERT INTO app_accounts
               (user_id, username, password_hash, role, created_at, updated_at)
             VALUES ($1, $2, $3, 'admin', $4, $4)`,
          [ids.user, username, passwordHash, session.now],
        );
        await client.query(
          `INSERT INTO families (id, display_name, created_by_user_id, created_at)
             VALUES ($1, 'Домашнее пространство', $2, $3)`,
          [ids.family, ids.user, session.now],
        );
        await client.query(
          `INSERT INTO family_memberships (id, family_id, user_id, role, status, created_at)
             VALUES ($1, $2, $3, 'owner', 'active', $4)`,
          [ids.membership, ids.family, ids.user, session.now],
        );
        const profileHandle = await createPatientProfile(client, {
          id: ids.profile,
          familyId: ids.family,
          displayName,
          kind: "adult",
          linkedUserId: ids.user,
          createdByUserId: ids.user,
          createdAt: session.now.toISOString(),
          username,
        });
        await client.query(
          `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
          [session.id, ids.user, session.tokenHash, session.expiresAt, session.now],
        );
        await insertAudit(client, {
          familyId: null,
          actorUserId: ids.user,
          action: "account.bootstrap.completed",
          resourceType: "User",
          resourceId: ids.user,
          correlationId,
          createdAt: session.now,
        });
        await insertAudit(client, {
          familyId: ids.family,
          actorUserId: ids.user,
          action: "family.created",
          resourceType: "Family",
          resourceId: ids.family,
          correlationId,
          createdAt: session.now,
        });
        await insertAudit(client, {
          familyId: ids.family,
          actorUserId: ids.user,
          action: "profile.created",
          resourceType: "PatientProfile",
          resourceId: ids.profile,
          correlationId,
          createdAt: session.now,
        });
        return profileHandle;
      });
      const user: AppAccountUser = { id: ids.user, username, displayName, role: "admin" };
      return {
        response: {
          contractVersion: ACCOUNT_CONTRACT_VERSION,
          user,
          family: {
            id: ids.family,
            displayName: "Домашнее пространство",
            role: "owner",
            createdAt: session.now.toISOString(),
          },
          profile: {
            id: ids.profile,
            familyId: ids.family,
            displayName,
            handle,
            kind: "adult",
            access: "owner",
            createdAt: session.now.toISOString(),
          },
        },
        cookie: sessionCookie(session.token, session.expiresAt),
      };
    },
  };
}
