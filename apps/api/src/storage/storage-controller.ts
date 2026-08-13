import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, parse, resolve } from "node:path";
import type { HOME_SETTINGS_CONTRACT_VERSION, HomeStorageStatus } from "@veylta/contracts";
import type { ObjectStorageRuntimeConfig } from "../config.js";
import type { Database, DatabaseClient } from "../database/pool.js";
import { createLocalObjectStorage } from "./local-object-storage.js";
import {
  createObjectStorageKey,
  type ExpectedObjectMetadata,
  type FinalizeObjectResult,
  type ObjectMetadata,
  type ObjectRead,
  type ObjectStorage,
  ObjectStorageIntegrityError,
  type ObjectStorageKey,
  ObjectStorageNotFoundError,
  type PutStagingRequest,
  type RecoveryDeletionRequest,
  type StagedObjectMetadata,
} from "./object-storage.js";
import { createS3ObjectStorage } from "./s3-object-storage.js";

interface StorageSettingsRow {
  driver: "local" | "s3";
  current_root: string | null;
  target_root: string | null;
  state: "stable" | "copying" | "failed";
  generation: number;
  last_failure_code: "TARGET_INVALID" | "COPY_FAILED" | "VERIFY_FAILED" | null;
}

interface BlobRow {
  storage_key: string;
  content_type: string;
  byte_size: number;
  sha256: string;
}

export interface StorageRelocationAudit {
  actorUserId: string;
  correlationId: string;
}

export interface StorageController extends ObjectStorage {
  initialize(): Promise<void>;
  status(): Promise<HomeStorageStatus>;
  relocate(rootPath: string, audit: StorageRelocationAudit): Promise<HomeStorageStatus>;
}

export class StorageRelocationNotSupportedError extends Error {}
export class StorageRelocationValidationError extends Error {}
export class StorageRelocationFailedError extends Error {
  constructor(readonly code: "COPY_FAILED" | "VERIFY_FAILED") {
    super(code);
  }
}

function normalizedRootPath(value: string): string {
  if (value.length < 2 || value.length > 2048 || value.includes("\u0000") || !isAbsolute(value)) {
    throw new StorageRelocationValidationError();
  }
  const path = resolve(value);
  if (path === parse(path).root || path === resolve(homedir())) {
    throw new StorageRelocationValidationError();
  }
  return path;
}

function status(row: StorageSettingsRow): HomeStorageStatus {
  return {
    driver: row.driver,
    rootPath: row.current_root,
    state: row.state,
    targetRootPath: row.target_root,
    generation: Number(row.generation),
    relocationSupported: row.driver === "local",
    lastFailureCode: row.last_failure_code,
  };
}

async function settingsRow(database: Database | DatabaseClient): Promise<StorageSettingsRow> {
  const row = (
    await database.query<StorageSettingsRow>(
      `SELECT driver, current_root, target_root, state, generation, last_failure_code
       FROM home_storage_settings WHERE singleton = 1`,
    )
  ).rows[0];
  if (row === undefined) throw new ObjectStorageIntegrityError("Storage settings are missing");
  return row;
}

function expected(row: BlobRow): ExpectedObjectMetadata {
  const byteSize = Number(row.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || !/^[a-f0-9]{64}$/.test(row.sha256)) {
    throw new ObjectStorageIntegrityError("Document blob metadata is invalid");
  }
  return { contentType: row.content_type, byteSize, sha256: row.sha256 };
}

async function copyObject(
  source: ObjectStorage,
  target: ObjectStorage,
  row: BlobRow,
): Promise<void> {
  const key = createObjectStorageKey(row.storage_key);
  const metadata = expected(row);
  const existing = await target.stat(key);
  if (existing !== null) {
    await target.get(key, metadata);
    return;
  }
  const sourceObject = await source.get(key, metadata);
  const stagingKey = createObjectStorageKey(`staging/relocation_${randomUUID()}`);
  try {
    await target.putStaging({
      key: stagingKey,
      body: sourceObject.body,
      contentType: metadata.contentType,
      maxBytes: metadata.byteSize,
    });
    await target.finalize(stagingKey, key);
    await target.get(key, metadata);
  } catch (error) {
    await target.deleteStaging(stagingKey).catch(() => false);
    throw error;
  }
}

class RuntimeStorageController implements StorageController {
  readonly contractVersion: ObjectStorage["contractVersion"];
  readonly #stagedRoots = new Map<ObjectStorageKey, ObjectStorage>();
  #active: ObjectStorage | null = null;
  #activeGeneration = 0;
  #relocating = false;

  constructor(
    private readonly database: Database,
    private readonly configured: ObjectStorageRuntimeConfig,
  ) {
    this.contractVersion = this.staticStorage().contractVersion;
  }

  private staticStorage(): ObjectStorage {
    return this.configured.mode === "local"
      ? createLocalObjectStorage(this.configured.rootPath)
      : createS3ObjectStorage(this.configured);
  }

  private storageFor(row: StorageSettingsRow): ObjectStorage {
    if (row.driver === "local") {
      if (row.current_root === null) throw new ObjectStorageIntegrityError();
      return createLocalObjectStorage(row.current_root);
    }
    if (this.configured.mode !== "s3") {
      throw new ObjectStorageIntegrityError("S3 settings require S3 runtime configuration");
    }
    return createS3ObjectStorage(this.configured);
  }

  private activeStorage(): ObjectStorage {
    if (this.#active === null) {
      throw new ObjectStorageIntegrityError("Storage controller is not initialized");
    }
    return this.#active;
  }

  private activate(row: StorageSettingsRow): void {
    this.#active = this.storageFor(row);
    this.#activeGeneration = Number(row.generation);
  }

  private async refreshIfChanged(): Promise<boolean> {
    const row = await settingsRow(this.database);
    if (Number(row.generation) === this.#activeGeneration) return false;
    this.activate(row);
    return true;
  }

  async initialize(): Promise<void> {
    await this.database.transaction(async (client) => {
      const existing = await client.query<{ count: number }>(
        "SELECT count(*) AS count FROM home_storage_settings",
      );
      if (Number(existing.rows[0]?.count) !== 0) return;
      await client.query(
        `INSERT INTO home_storage_settings
           (singleton, driver, current_root, state, generation)
         VALUES (1, $1, $2, 'stable', 1)`,
        [this.configured.mode, this.configured.mode === "local" ? this.configured.rootPath : null],
      );
    });
    this.activate(await settingsRow(this.database));
    if (this.configured.mode === "local") {
      await this.staticStorage().exists(createObjectStorageKey("storage_initialization_probe"));
    }
  }

  async status(): Promise<HomeStorageStatus> {
    return status(await settingsRow(this.database));
  }

  async relocate(rootPath: string, audit: StorageRelocationAudit): Promise<HomeStorageStatus> {
    const targetRoot = normalizedRootPath(rootPath);
    if (this.#relocating || this.#stagedRoots.size > 0) {
      throw new StorageRelocationNotSupportedError();
    }
    this.#relocating = true;
    let sourceRoot = "";
    try {
      const relocated = await this.database.transaction(async (client) => {
        const current = await settingsRow(client);
        if (current.driver !== "local" || current.current_root === null) {
          throw new StorageRelocationNotSupportedError();
        }
        sourceRoot = current.current_root;
        if (targetRoot === current.current_root) throw new StorageRelocationValidationError();
        await client.query(
          `UPDATE home_storage_settings
              SET state = 'copying', target_root = $1, last_failure_code = NULL,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE singleton = 1`,
          [targetRoot],
        );
        const source = createLocalObjectStorage(current.current_root);
        const target = createLocalObjectStorage(targetRoot);
        const blobs = await client.query<BlobRow>(
          "SELECT storage_key, content_type, byte_size, sha256 FROM document_blobs ORDER BY id",
        );
        for (const blob of blobs.rows) await copyObject(source, target, blob);
        await client.query(
          `UPDATE home_storage_settings
              SET current_root = $1, target_root = NULL, state = 'stable',
                  generation = generation + 1, last_failure_code = NULL,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE singleton = 1`,
          [targetRoot],
        );
        await client.query(
          `INSERT INTO audit_events
             (id, family_id, actor_user_id, action, resource_type, resource_id, result,
              correlation_id, metadata)
           VALUES ($1, NULL, $2, 'settings.storage.relocated', 'HomeStorage', 'primary',
                   'success', $3, $4)`,
          [
            randomUUID(),
            audit.actorUserId,
            audit.correlationId,
            { contractVersion: "home-settings/v1" satisfies typeof HOME_SETTINGS_CONTRACT_VERSION },
          ],
        );
        return status(await settingsRow(client));
      });
      this.activate({
        driver: relocated.driver,
        current_root: relocated.rootPath,
        target_root: relocated.targetRootPath,
        state: relocated.state,
        generation: relocated.generation,
        last_failure_code: relocated.lastFailureCode,
      });
      return relocated;
    } catch (error) {
      if (
        error instanceof StorageRelocationNotSupportedError ||
        error instanceof StorageRelocationValidationError
      ) {
        throw error;
      }
      const code = error instanceof ObjectStorageIntegrityError ? "VERIFY_FAILED" : "COPY_FAILED";
      if (sourceRoot.length > 0) {
        await this.database.query(
          `UPDATE home_storage_settings
              SET state = 'failed', target_root = $1, last_failure_code = $2,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE singleton = 1 AND driver = 'local' AND current_root = $3`,
          [targetRoot, code, sourceRoot],
        );
      }
      throw new StorageRelocationFailedError(code);
    } finally {
      this.#relocating = false;
    }
  }

  async putStaging(request: PutStagingRequest): Promise<StagedObjectMetadata> {
    if (this.#relocating) throw new StorageRelocationNotSupportedError();
    const storage = this.activeStorage();
    const staged = await storage.putStaging(request);
    this.#stagedRoots.set(request.key, storage);
    return staged;
  }

  async finalize(
    stagingKey: ObjectStorageKey,
    finalKey: ObjectStorageKey,
  ): Promise<FinalizeObjectResult> {
    const storage = this.#stagedRoots.get(stagingKey) ?? this.activeStorage();
    try {
      return await storage.finalize(stagingKey, finalKey);
    } finally {
      this.#stagedRoots.delete(stagingKey);
    }
  }

  async get(key: ObjectStorageKey, metadata: ExpectedObjectMetadata): Promise<ObjectRead> {
    try {
      return await this.activeStorage().get(key, metadata);
    } catch (error) {
      if (!(error instanceof ObjectStorageNotFoundError) || !(await this.refreshIfChanged())) {
        throw error;
      }
      return this.activeStorage().get(key, metadata);
    }
  }

  async stat(key: ObjectStorageKey): Promise<ObjectMetadata | null> {
    const metadata = await this.activeStorage().stat(key);
    if (metadata !== null || !(await this.refreshIfChanged())) return metadata;
    return this.activeStorage().stat(key);
  }

  async exists(key: ObjectStorageKey): Promise<boolean> {
    if (await this.activeStorage().exists(key)) return true;
    return (await this.refreshIfChanged()) && this.activeStorage().exists(key);
  }

  async deleteStaging(key: ObjectStorageKey): Promise<boolean> {
    const storage = this.#stagedRoots.get(key) ?? this.activeStorage();
    try {
      return await storage.deleteStaging(key);
    } finally {
      this.#stagedRoots.delete(key);
    }
  }

  async deleteForRecovery(
    key: ObjectStorageKey,
    request: RecoveryDeletionRequest,
  ): Promise<boolean> {
    return this.activeStorage().deleteForRecovery(key, request);
  }
}

export function createStorageController(
  database: Database,
  configured: ObjectStorageRuntimeConfig,
): StorageController {
  return new RuntimeStorageController(database, configured);
}

export function createLocalStorageController(
  database: Database,
  rootPath: string,
): StorageController {
  return createStorageController(database, { mode: "local", rootPath: resolve(rootPath) });
}
