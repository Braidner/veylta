import type { Readable } from "node:stream";
import type { OBJECT_STORAGE_CONTRACT_VERSION } from "@veylta/contracts";

declare const objectStorageKeyBrand: unique symbol;

export type ObjectStorageKey = string & {
  readonly [objectStorageKeyBrand]: "ObjectStorageKey";
};

export interface PutStagingRequest {
  /** A trusted opaque identifier, never a filename or filesystem path. */
  key: ObjectStorageKey;
  body: Readable;
  contentType: string;
  maxBytes: number;
}

export interface StagedObjectMetadata {
  contractVersion: typeof OBJECT_STORAGE_CONTRACT_VERSION;
  key: ObjectStorageKey;
  contentType: string;
  byteSize: number;
  sha256: string;
}

export interface ObjectMetadata {
  contractVersion: typeof OBJECT_STORAGE_CONTRACT_VERSION;
  key: ObjectStorageKey;
  contentType: string;
  byteSize: number;
  sha256: string;
}

export interface ObjectRead {
  body: Readable;
  metadata: ObjectMetadata;
}

export type ExpectedObjectMetadata = Pick<ObjectMetadata, "byteSize" | "contentType" | "sha256">;

export type FinalizeObjectResult =
  | { status: "created"; metadata: ObjectMetadata }
  | { status: "already_exists"; metadata: ObjectMetadata };

export interface RecoveryDeletionRequest {
  intent: "repair_or_recovery";
  reason: string;
}

export interface ObjectStorage {
  readonly contractVersion: typeof OBJECT_STORAGE_CONTRACT_VERSION;
  putStaging(request: PutStagingRequest): Promise<StagedObjectMetadata>;
  finalize(stagingKey: ObjectStorageKey, finalKey: ObjectStorageKey): Promise<FinalizeObjectResult>;
  get(key: ObjectStorageKey, expected: ExpectedObjectMetadata): Promise<ObjectRead>;
  stat(key: ObjectStorageKey): Promise<ObjectMetadata | null>;
  exists(key: ObjectStorageKey): Promise<boolean>;
  deleteStaging(key: ObjectStorageKey): Promise<boolean>;
  deleteForRecovery(key: ObjectStorageKey, request: RecoveryDeletionRequest): Promise<boolean>;
}

const keyPattern = /^[a-z0-9][a-z0-9_-]{0,127}(?:\/[a-z0-9][a-z0-9_-]{0,127}){0,7}$/;

export class ObjectStorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageValidationError";
  }
}

export class ObjectStorageSizeLimitError extends Error {
  constructor(maxBytes: number) {
    super(`Object exceeded the ${maxBytes} byte staging limit`);
    this.name = "ObjectStorageSizeLimitError";
  }
}

export class ObjectStorageNotFoundError extends Error {
  constructor() {
    super("Object does not exist");
    this.name = "ObjectStorageNotFoundError";
  }
}

export class StagingObjectNotFoundError extends Error {
  constructor() {
    super("Staging object does not exist");
    this.name = "StagingObjectNotFoundError";
  }
}

export class ObjectStorageAlreadyExistsError extends Error {
  constructor() {
    super("Object already exists and is immutable");
    this.name = "ObjectStorageAlreadyExistsError";
  }
}

export class ObjectStorageSecurityError extends Error {
  constructor(message = "Unsafe storage path") {
    super(message);
    this.name = "ObjectStorageSecurityError";
  }
}

export class ObjectStorageIntegrityError extends Error {
  constructor(message = "Stored object metadata or content is inconsistent") {
    super(message);
    this.name = "ObjectStorageIntegrityError";
  }
}

export function createObjectStorageKey(value: string): ObjectStorageKey {
  assertObjectStorageKey(value);
  return value as ObjectStorageKey;
}

export function assertObjectStorageKey(value: string): asserts value is ObjectStorageKey {
  if (value.length > 512 || !keyPattern.test(value)) {
    throw new ObjectStorageValidationError(
      "Object key must contain only lower-case opaque identifier segments",
    );
  }
}

export function assertContentType(value: string): void {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (value.length < 3 || value.length > 255 || !value.includes("/") || hasControlCharacter) {
    throw new ObjectStorageValidationError("Content type is invalid");
  }
}

export function assertMaxBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ObjectStorageValidationError("maxBytes must be a positive safe integer");
  }
}

export function assertRecoveryDeletionRequest(request: RecoveryDeletionRequest): void {
  if (
    request.intent !== "repair_or_recovery" ||
    request.reason.trim().length === 0 ||
    request.reason.length > 500
  ) {
    throw new ObjectStorageValidationError("Recovery deletion requires a bounded reason");
  }
}
