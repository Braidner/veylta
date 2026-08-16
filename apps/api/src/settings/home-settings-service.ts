import { randomUUID } from "node:crypto";
import {
  type CodexExecutionPreference,
  type CodexPreferenceUpdateRequest,
  type CodexPreferenceUpdateResponse,
  type CodexRuntimeActionResponse,
  type CodexRuntimeStatus,
  HOME_SETTINGS_CONTRACT_VERSION,
  type HomeSettingsResponse,
  type HomeStorageStatus,
  type ManagedAccount,
  type ManagedAccountCreateRequest,
  type ManagedAccountCreateResponse,
  type StorageRelocationResponse,
} from "@veylta/contracts";
import { hashPassword } from "../accounts/password.js";
import type { Database, DatabaseClient } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import type { StorageController } from "../storage/storage-controller.js";
import type { CodexPreferencesStore } from "./codex-preferences.js";

export type { CodexRuntimeProbe, CodexRuntimeProbeResult } from "./codex-runtime.js";

import type { CodexRuntimeProbe, CodexRuntimeProbeResult } from "./codex-runtime.js";

interface AccountRow {
  user_id: string;
  username: string;
  display_name: string;
  role: "admin" | "user";
  disabled_at: string | null;
}

export interface HomeSettingsService {
  get(actor: SessionActor): Promise<HomeSettingsResponse>;
  createAccount(
    actor: SessionActor,
    input: ManagedAccountCreateRequest,
    correlationId: string,
  ): Promise<ManagedAccountCreateResponse>;
  relocateStorage(
    actor: SessionActor,
    rootPath: string,
    correlationId: string,
  ): Promise<StorageRelocationResponse>;
  startCodex(actor: SessionActor, correlationId: string): Promise<CodexRuntimeActionResponse>;
  updateCodexPreference(
    actor: SessionActor,
    input: CodexPreferenceUpdateRequest,
    correlationId: string,
  ): Promise<CodexPreferenceUpdateResponse>;
}

export class CodexCatalogUnavailableError extends Error {}
export class CodexPreferenceUnsupportedError extends Error {}

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function requireAdministrator(actor: SessionActor): void {
  if (actor.accountRole !== "admin") throw new ResourceNotFoundError();
}

function managedAccount(row: AccountRow): ManagedAccount {
  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.disabled_at === null ? "active" : "disabled",
  };
}

function codexStatus(
  value: CodexRuntimeProbeResult,
  preference: CodexExecutionPreference,
): CodexRuntimeStatus {
  return {
    ...value,
    preference,
    authenticationOwner: "codex_cli",
    experimental: true,
  };
}

async function audit(
  client: DatabaseClient,
  input: {
    familyId: string | null;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    correlationId: string;
    result?: "success" | "failed";
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      input.familyId,
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.result ?? "success",
      input.correlationId,
      { contractVersion: HOME_SETTINGS_CONTRACT_VERSION },
    ],
  );
}

async function accounts(database: Database | DatabaseClient): Promise<ManagedAccount[]> {
  const rows = await database.query<AccountRow>(
    `SELECT a.user_id, a.username, a.role, u.display_name, u.disabled_at
       FROM app_accounts a
       JOIN users u ON u.id = a.user_id
      ORDER BY CASE a.role WHEN 'admin' THEN 0 ELSE 1 END, a.username`,
  );
  return rows.rows.map(managedAccount);
}

export function createHomeSettingsService(
  database: Database,
  storage: StorageController,
  codex: CodexRuntimeProbe,
  preferences: CodexPreferencesStore,
): HomeSettingsService {
  return {
    async get(actor) {
      requireAdministrator(actor);
      const [runtime, preference, storageStatus, accountList] = await Promise.all([
        codex.status(),
        preferences.get(),
        storage.status(),
        accounts(database),
      ]);
      return {
        contractVersion: HOME_SETTINGS_CONTRACT_VERSION,
        codex: codexStatus(runtime, preference),
        storage: storageStatus,
        accounts: accountList,
      };
    },

    async createAccount(actor, input, correlationId) {
      requireAdministrator(actor);
      const username = input.username.trim().toLowerCase();
      const displayName = input.displayName.trim();
      if (
        !usernamePattern.test(username) ||
        displayName.length === 0 ||
        displayName.length > 120 ||
        input.password.length < 12 ||
        input.password.length > 128 ||
        Buffer.byteLength(input.password, "utf8") > 256 ||
        !["admin", "user"].includes(input.role)
      ) {
        throw new DomainValidationError();
      }
      const passwordHash = await hashPassword(input.password);
      const ids = { user: randomUUID(), membership: randomUUID(), profile: randomUUID() };
      const now = new Date();
      return database.transaction(async (client) => {
        const duplicate = await client.query<{ count: number }>(
          "SELECT count(*) AS count FROM app_accounts WHERE username = $1 COLLATE NOCASE",
          [username],
        );
        if (Number(duplicate.rows[0]?.count) !== 0) throw new DomainConflictError();
        const family = (
          await client.query<{ family_id: string }>(
            `SELECT family_id FROM family_memberships
              WHERE user_id = $1 AND role = 'owner' AND status = 'active'
              ORDER BY created_at LIMIT 1`,
            [actor.userId],
          )
        ).rows[0];
        if (family === undefined) throw new ResourceNotFoundError();
        await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
          ids.user,
          displayName,
          now,
        ]);
        await client.query(
          `INSERT INTO app_accounts
             (user_id, username, password_hash, role, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [ids.user, username, passwordHash, input.role, now],
        );
        await client.query(
          `INSERT INTO family_memberships
             (id, family_id, user_id, role, status, created_at)
           VALUES ($1, $2, $3, $4, 'active', $5)`,
          [
            ids.membership,
            family.family_id,
            ids.user,
            input.role === "admin" ? "owner" : "adult_member",
            now,
          ],
        );
        await client.query(
          `INSERT INTO patient_profiles
             (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
           VALUES ($1, $2, $3, 'adult', $4, $5, $6)`,
          [ids.profile, family.family_id, displayName, ids.user, actor.userId, now],
        );
        await audit(client, {
          familyId: null,
          actorUserId: actor.userId,
          action: "settings.account.created",
          resourceType: "User",
          resourceId: ids.user,
          correlationId,
        });
        await audit(client, {
          familyId: family.family_id,
          actorUserId: actor.userId,
          action: "profile.created",
          resourceType: "PatientProfile",
          resourceId: ids.profile,
          correlationId,
        });
        const account: ManagedAccount = {
          id: ids.user,
          username,
          displayName,
          role: input.role,
          status: "active",
        };
        return {
          contractVersion: HOME_SETTINGS_CONTRACT_VERSION,
          account,
          profile: {
            id: ids.profile,
            familyId: family.family_id,
            displayName,
            kind: "adult",
            access: input.role === "admin" ? "owner" : "self",
            createdAt: now.toISOString(),
          },
        };
      });
    },

    async relocateStorage(actor, rootPath, correlationId) {
      requireAdministrator(actor);
      const storageStatus: HomeStorageStatus = await storage.relocate(rootPath, {
        actorUserId: actor.userId,
        correlationId,
      });
      return { contractVersion: HOME_SETTINGS_CONTRACT_VERSION, storage: storageStatus };
    },

    async startCodex(actor, correlationId) {
      requireAdministrator(actor);
      const [runtimeResult, preference] = await Promise.all([
        codex.startDaemon(),
        preferences.get(),
      ]);
      const runtime = codexStatus(runtimeResult, preference);
      await database.transaction((client) =>
        audit(client, {
          familyId: null,
          actorUserId: actor.userId,
          action: "settings.codex.start",
          resourceType: "CodexRuntime",
          resourceId: "primary",
          correlationId,
          result: runtime.daemonRunning ? "success" : "failed",
        }),
      );
      return {
        contractVersion: HOME_SETTINGS_CONTRACT_VERSION,
        codex: runtime,
      };
    },

    async updateCodexPreference(actor, input, correlationId) {
      requireAdministrator(actor);
      const runtime = await codex.status();
      if (runtime.models.length === 0) throw new CodexCatalogUnavailableError();
      const model = runtime.models.find((candidate) => candidate.id === input.modelId);
      if (
        model === undefined ||
        !model.supportedReasoningEfforts.includes(input.reasoningEffort) ||
        !model.supportedReasoningEfforts.includes(input.documentReasoningEffort) ||
        (input.serviceTier === "fast" && !model.supportsFastMode)
      ) {
        throw new CodexPreferenceUnsupportedError();
      }
      const preference: CodexExecutionPreference = {
        modelId: model.id,
        reasoningEffort: input.reasoningEffort,
        documentReasoningEffort: input.documentReasoningEffort,
        serviceTier: input.serviceTier,
      };
      await database.transaction(async (client) => {
        await preferences.write(client, preference, actor.userId, new Date());
        await audit(client, {
          familyId: null,
          actorUserId: actor.userId,
          action: "settings.codex.preference_updated",
          resourceType: "CodexRuntime",
          resourceId: "primary",
          correlationId,
        });
      });
      return {
        contractVersion: HOME_SETTINGS_CONTRACT_VERSION,
        codex: codexStatus(runtime, preference),
      };
    },
  };
}
