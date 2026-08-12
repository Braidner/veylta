import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MAX_SYNTHETIC_DOCUMENT_BYTES, OBJECT_STORAGE_CONTRACT_VERSION } from "@veylta/contracts";
import {
  assertContentType,
  assertMaxBytes,
  assertObjectStorageKey,
  assertRecoveryDeletionRequest,
  type ExpectedObjectMetadata,
  type FinalizeObjectResult,
  type ObjectMetadata,
  type ObjectRead,
  type ObjectStorage,
  ObjectStorageAlreadyExistsError,
  ObjectStorageIntegrityError,
  type ObjectStorageKey,
  ObjectStorageNotFoundError,
  ObjectStorageSecurityError,
  ObjectStorageSizeLimitError,
  type PutStagingRequest,
  type RecoveryDeletionRequest,
  type StagedObjectMetadata,
  StagingObjectNotFoundError,
} from "./object-storage.js";

const payloadFilename = "payload";
const metadataFilename = "metadata.json";
const finalizingMetadataFilename = "metadata.finalizing.json";
const maximumMetadataBytes = 16 * 1024;

interface LocalObjectStorageOptions {
  rootPath: string;
}

interface StorageLayout {
  rootPath: string;
  stagingPath: string;
  objectsPath: string;
}

interface StoredMetadata {
  contractVersion: typeof OBJECT_STORAGE_CONTRACT_VERSION;
  key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isMissing(error: unknown): boolean {
  return isErrorCode(error, "ENOENT");
}

function assertContained(rootPath: string, candidatePath: string): void {
  const candidateRelativePath = relative(rootPath, candidatePath);
  if (
    candidateRelativePath === ".." ||
    candidateRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(candidateRelativePath)
  ) {
    throw new ObjectStorageSecurityError("Storage path escaped its configured root");
  }
}

function objectDigest(key: ObjectStorageKey): string {
  assertObjectStorageKey(key);
  return createHash("sha256").update(key).digest("hex");
}

function storedMetadata(value: unknown): StoredMetadata {
  if (typeof value !== "object" || value === null) {
    throw new ObjectStorageIntegrityError();
  }
  const record = value as Record<string, unknown>;
  if (
    record.contractVersion !== OBJECT_STORAGE_CONTRACT_VERSION ||
    typeof record.key !== "string" ||
    typeof record.contentType !== "string" ||
    typeof record.byteSize !== "number" ||
    !Number.isSafeInteger(record.byteSize) ||
    record.byteSize < 0 ||
    record.byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256)
  ) {
    throw new ObjectStorageIntegrityError();
  }
  try {
    assertObjectStorageKey(record.key);
    assertContentType(record.contentType);
  } catch {
    throw new ObjectStorageIntegrityError();
  }
  return {
    contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
    key: record.key,
    contentType: record.contentType,
    byteSize: record.byteSize,
    sha256: record.sha256,
  };
}

function publicMetadata(metadata: StoredMetadata): ObjectMetadata {
  assertObjectStorageKey(metadata.key);
  return {
    contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
    key: metadata.key,
    contentType: metadata.contentType,
    byteSize: metadata.byteSize,
    sha256: metadata.sha256,
  };
}

function assertExpectedMetadata(metadata: StoredMetadata, expected: ExpectedObjectMetadata): void {
  if (
    metadata.contentType !== expected.contentType ||
    metadata.byteSize !== expected.byteSize ||
    metadata.sha256 !== expected.sha256
  ) {
    throw new ObjectStorageIntegrityError("Object metadata does not match the expected object");
  }
}

function bytesFromChunk(chunk: unknown, encoding: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === "string") return Buffer.from(chunk, encoding);
  throw new ObjectStorageIntegrityError("The staging stream emitted a non-binary chunk");
}

async function readAtMost(
  handle: Awaited<ReturnType<typeof open>>,
  maximumBytes: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maximumBytes + 1);
  let total = 0;
  while (total < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, total, buffer.byteLength - total, total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

async function assertSafeDirectory(directoryPath: string, rootPath: string): Promise<void> {
  assertContained(rootPath, directoryPath);
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(directoryPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
    try {
      await mkdir(directoryPath, { mode: 0o700 });
    } catch (mkdirError) {
      if (!isErrorCode(mkdirError, "EEXIST")) throw mkdirError;
    }
    entry = await lstat(directoryPath);
  }
  if (entry.isSymbolicLink()) {
    throw new ObjectStorageSecurityError("Storage directory must not be a symbolic link");
  }
  if (!entry.isDirectory()) {
    throw new ObjectStorageIntegrityError("Storage directory is not a directory");
  }
  const canonicalPath = await realpath(directoryPath);
  assertContained(rootPath, canonicalPath);
}

async function assertExistingContainer(directoryPath: string, rootPath: string): Promise<boolean> {
  assertContained(rootPath, directoryPath);
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(directoryPath);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (entry.isSymbolicLink()) {
    throw new ObjectStorageSecurityError("Object container must not be a symbolic link");
  }
  if (!entry.isDirectory()) {
    throw new ObjectStorageIntegrityError("Object container is not a directory");
  }
  const canonicalPath = await realpath(directoryPath);
  assertContained(rootPath, canonicalPath);
  return true;
}

async function readMetadataFile(metadataPath: string): Promise<StoredMetadata> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(metadataPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isErrorCode(error, "ELOOP")) {
      throw new ObjectStorageSecurityError("Metadata must not be a symbolic link");
    }
    if (isMissing(error)) {
      throw new ObjectStorageIntegrityError("Object metadata is missing");
    }
    throw error;
  }
  try {
    const metadataStat = await handle.stat();
    if (!metadataStat.isFile() || metadataStat.size > maximumMetadataBytes) {
      throw new ObjectStorageIntegrityError("Object metadata is not a bounded regular file");
    }
    const encodedBytes = await readAtMost(handle, maximumMetadataBytes);
    if (encodedBytes.byteLength !== metadataStat.size) {
      throw new ObjectStorageIntegrityError("Object metadata changed while it was read");
    }
    const encoded = encodedBytes.toString("utf8");
    try {
      return storedMetadata(JSON.parse(encoded) as unknown);
    } catch (error) {
      if (error instanceof ObjectStorageIntegrityError) throw error;
      throw new ObjectStorageIntegrityError("Object metadata is not valid JSON");
    }
  } finally {
    await handle.close();
  }
}

async function assertPayloadIntegrity(
  payloadPath: string,
  expected: Pick<StoredMetadata, "byteSize" | "sha256">,
): Promise<void> {
  await verifiedPayloadSnapshot(payloadPath, expected);
}

async function verifiedPayloadSnapshot(
  payloadPath: string,
  expected: Pick<StoredMetadata, "byteSize" | "sha256">,
): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(payloadPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isErrorCode(error, "ELOOP")) {
      throw new ObjectStorageSecurityError("Payload must not be a symbolic link");
    }
    if (isMissing(error)) {
      throw new ObjectStorageIntegrityError("Object payload is missing");
    }
    throw error;
  }
  try {
    const payloadStat = await handle.stat();
    if (!payloadStat.isFile() || payloadStat.size !== expected.byteSize) {
      throw new ObjectStorageIntegrityError("Object payload size does not match metadata");
    }
    const bytes = await readAtMost(handle, expected.byteSize);
    if (
      bytes.byteLength !== expected.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256
    ) {
      throw new ObjectStorageIntegrityError("Object payload checksum does not match metadata");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function removeContainer(
  directoryPath: string,
  rootPath: string,
  allowedEntries: ReadonlySet<string>,
): Promise<boolean> {
  if (!(await assertExistingContainer(directoryPath, rootPath))) return false;
  const entries = await readdir(directoryPath);
  for (const entry of entries) {
    if (!allowedEntries.has(entry)) {
      throw new ObjectStorageIntegrityError("Object container contains an unexpected entry");
    }
    const entryPath = join(directoryPath, entry);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
      throw new ObjectStorageSecurityError("Object container contains an unsafe entry");
    }
    await unlink(entryPath);
  }
  await rmdir(directoryPath);
  return true;
}

export class LocalObjectStorage implements ObjectStorage {
  readonly contractVersion = OBJECT_STORAGE_CONTRACT_VERSION;
  readonly #configuredRootPath: string;
  #canonicalRootPath: string | undefined;

  constructor(options: LocalObjectStorageOptions) {
    if (options.rootPath.trim().length === 0 || options.rootPath.includes("\u0000")) {
      throw new ObjectStorageSecurityError("A non-empty storage root is required");
    }
    this.#configuredRootPath = resolve(options.rootPath);
  }

  async #layout(): Promise<StorageLayout> {
    await mkdir(this.#configuredRootPath, { recursive: true, mode: 0o700 });
    const configuredRootStat = await lstat(this.#configuredRootPath);
    if (configuredRootStat.isSymbolicLink() || !configuredRootStat.isDirectory()) {
      throw new ObjectStorageSecurityError("Configured storage root must be a real directory");
    }
    const canonicalRootPath = await realpath(this.#configuredRootPath);
    if (this.#canonicalRootPath !== undefined && this.#canonicalRootPath !== canonicalRootPath) {
      throw new ObjectStorageSecurityError("Configured storage root changed while in use");
    }
    this.#canonicalRootPath = canonicalRootPath;

    const stagingPath = join(canonicalRootPath, "staging");
    const objectsPath = join(canonicalRootPath, "objects");
    await assertSafeDirectory(stagingPath, canonicalRootPath);
    await assertSafeDirectory(objectsPath, canonicalRootPath);
    return { rootPath: canonicalRootPath, stagingPath, objectsPath };
  }

  async #containerPath(
    namespacePath: string,
    rootPath: string,
    key: ObjectStorageKey,
    createPrefix: boolean,
  ): Promise<string> {
    const digest = objectDigest(key);
    const prefixPath = join(namespacePath, digest.slice(0, 2));
    if (createPrefix) {
      await assertSafeDirectory(prefixPath, rootPath);
    } else if (!(await assertExistingContainer(prefixPath, rootPath))) {
      return join(prefixPath, digest);
    }
    return join(prefixPath, digest);
  }

  async putStaging(request: PutStagingRequest): Promise<StagedObjectMetadata> {
    assertObjectStorageKey(request.key);
    assertContentType(request.contentType);
    assertMaxBytes(request.maxBytes);
    const layout = await this.#layout();
    const directoryPath = await this.#containerPath(
      layout.stagingPath,
      layout.rootPath,
      request.key,
      true,
    );

    try {
      await mkdir(directoryPath, { mode: 0o700 });
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        if (!(await assertExistingContainer(directoryPath, layout.rootPath))) {
          throw new ObjectStorageIntegrityError();
        }
        throw new ObjectStorageAlreadyExistsError();
      }
      throw error;
    }

    const digest = createHash("sha256");
    let byteSize = 0;
    const meter = new Transform({
      transform(chunk: unknown, encoding: BufferEncoding, callback: TransformCallback): void {
        let bytes: Buffer;
        try {
          bytes = bytesFromChunk(chunk, encoding);
        } catch (error) {
          callback(error instanceof Error ? error : new ObjectStorageIntegrityError());
          return;
        }
        byteSize += bytes.byteLength;
        if (byteSize > request.maxBytes) {
          callback(new ObjectStorageSizeLimitError(request.maxBytes));
          return;
        }
        digest.update(bytes);
        callback(null, bytes);
      },
    });

    try {
      await pipeline(
        request.body,
        meter,
        createWriteStream(join(directoryPath, payloadFilename), {
          flags: "wx",
          mode: 0o600,
        }),
      );
      const metadata: StoredMetadata = {
        contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
        key: request.key,
        contentType: request.contentType,
        byteSize,
        sha256: digest.digest("hex"),
      };
      await writeFile(join(directoryPath, metadataFilename), `${JSON.stringify(metadata)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return {
        contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
        key: request.key,
        contentType: request.contentType,
        byteSize,
        sha256: metadata.sha256,
      };
    } catch (error) {
      await removeContainer(
        directoryPath,
        layout.rootPath,
        new Set([payloadFilename, metadataFilename]),
      ).catch(() => undefined);
      throw error;
    }
  }

  async finalize(
    stagingKey: ObjectStorageKey,
    finalKey: ObjectStorageKey,
  ): Promise<FinalizeObjectResult> {
    assertObjectStorageKey(stagingKey);
    assertObjectStorageKey(finalKey);
    const existing = await this.stat(finalKey);
    if (existing !== null) return { status: "already_exists", metadata: existing };

    const layout = await this.#layout();
    const stagingDirectoryPath = await this.#containerPath(
      layout.stagingPath,
      layout.rootPath,
      stagingKey,
      false,
    );
    if (!(await assertExistingContainer(stagingDirectoryPath, layout.rootPath))) {
      throw new StagingObjectNotFoundError();
    }
    const staged = await readMetadataFile(join(stagingDirectoryPath, metadataFilename));
    if (staged.key !== stagingKey && staged.key !== finalKey) {
      throw new ObjectStorageIntegrityError(
        "Staging metadata is not bound to this staging/final key pair",
      );
    }
    await assertPayloadIntegrity(join(stagingDirectoryPath, payloadFilename), staged);

    const finalDirectoryPath = await this.#containerPath(
      layout.objectsPath,
      layout.rootPath,
      finalKey,
      true,
    );
    if (await assertExistingContainer(finalDirectoryPath, layout.rootPath)) {
      const raced = await this.stat(finalKey);
      if (raced === null) throw new ObjectStorageIntegrityError();
      return { status: "already_exists", metadata: raced };
    }

    const finalMetadata: StoredMetadata = { ...staged, key: finalKey };
    const finalizingMetadataPath = join(stagingDirectoryPath, finalizingMetadataFilename);
    try {
      await writeFile(finalizingMetadataPath, `${JSON.stringify(finalMetadata)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
      const pending = await readMetadataFile(finalizingMetadataPath);
      if (pending.key !== finalKey || pending.sha256 !== finalMetadata.sha256) {
        throw new ObjectStorageIntegrityError("Staging object is bound to another final key");
      }
    }
    await rename(finalizingMetadataPath, join(stagingDirectoryPath, metadataFilename));

    try {
      await rename(stagingDirectoryPath, finalDirectoryPath);
    } catch (error) {
      const raced = await this.stat(finalKey);
      if (raced !== null) return { status: "already_exists", metadata: raced };
      throw error;
    }

    const created = await this.stat(finalKey);
    if (created === null) throw new ObjectStorageIntegrityError();
    return { status: "created", metadata: created };
  }

  async stat(key: ObjectStorageKey): Promise<ObjectMetadata | null> {
    assertObjectStorageKey(key);
    const layout = await this.#layout();
    const directoryPath = await this.#containerPath(
      layout.objectsPath,
      layout.rootPath,
      key,
      false,
    );
    if (!(await assertExistingContainer(directoryPath, layout.rootPath))) return null;
    const metadata = await readMetadataFile(join(directoryPath, metadataFilename));
    if (metadata.key !== key) {
      throw new ObjectStorageIntegrityError("Object metadata key does not match its location");
    }
    await assertPayloadIntegrity(join(directoryPath, payloadFilename), metadata);
    return publicMetadata(metadata);
  }

  async exists(key: ObjectStorageKey): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async get(key: ObjectStorageKey, expected: ExpectedObjectMetadata): Promise<ObjectRead> {
    assertObjectStorageKey(key);
    const layout = await this.#layout();
    const directoryPath = await this.#containerPath(
      layout.objectsPath,
      layout.rootPath,
      key,
      false,
    );
    if (!(await assertExistingContainer(directoryPath, layout.rootPath))) {
      throw new ObjectStorageNotFoundError();
    }
    const metadata = await readMetadataFile(join(directoryPath, metadataFilename));
    if (metadata.key !== key) {
      throw new ObjectStorageIntegrityError("Object metadata key does not match its location");
    }
    assertExpectedMetadata(metadata, expected);
    const snapshot = await verifiedPayloadSnapshot(join(directoryPath, payloadFilename), metadata);
    return { body: Readable.from([snapshot]), metadata: publicMetadata(metadata) };
  }

  async deleteStaging(key: ObjectStorageKey): Promise<boolean> {
    assertObjectStorageKey(key);
    const layout = await this.#layout();
    const directoryPath = await this.#containerPath(
      layout.stagingPath,
      layout.rootPath,
      key,
      false,
    );
    return removeContainer(
      directoryPath,
      layout.rootPath,
      new Set([payloadFilename, metadataFilename, finalizingMetadataFilename]),
    );
  }

  async deleteForRecovery(
    key: ObjectStorageKey,
    request: RecoveryDeletionRequest,
  ): Promise<boolean> {
    assertObjectStorageKey(key);
    assertRecoveryDeletionRequest(request);
    const layout = await this.#layout();
    const directoryPath = await this.#containerPath(
      layout.objectsPath,
      layout.rootPath,
      key,
      false,
    );
    return removeContainer(
      directoryPath,
      layout.rootPath,
      new Set([payloadFilename, metadataFilename]),
    );
  }
}

export function createLocalObjectStorage(rootPath: string): ObjectStorage {
  return new LocalObjectStorage({ rootPath });
}
