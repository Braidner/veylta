import { createHash } from "node:crypto";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CopyObjectCommand,
  type CopyObjectCommandInput,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
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

const metadataContractVersion = "veylta-contract-version";
const metadataKeyDigest = "veylta-key-digest";
const metadataByteSize = "veylta-byte-size";
const metadataSha256 = "veylta-sha256";
const metadataState = "veylta-state";
const completedStagingState = "staged";
const incompleteStagingState = "uploading";

export type S3ServerSideEncryption = { mode: "AES256" } | { mode: "aws:kms"; keyId: string };

export interface S3ObjectStorageOptions {
  bucket: string;
  client?: Pick<S3Client, "send">;
  encryption: S3ServerSideEncryption;
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix: string;
  region: string;
}

interface StoredS3Metadata {
  contractVersion: typeof OBJECT_STORAGE_CONTRACT_VERSION;
  key: ObjectStorageKey;
  contentType: string;
  byteSize: number;
  sha256: string;
}

interface HeadedObject {
  metadata: StoredS3Metadata;
  etag: string;
}

function providerErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    typeof error.$metadata.httpStatusCode === "number"
  ) {
    return error.$metadata.httpStatusCode;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return (
    providerErrorStatus(error) === 404 ||
    (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey"))
  );
}

function isPreconditionFailed(error: unknown): boolean {
  return (
    providerErrorStatus(error) === 412 ||
    (error instanceof Error && error.name === "PreconditionFailed")
  );
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new ObjectStorageIntegrityError(`S3 ${label} is invalid`);
  }
  return value;
}

function opaquePrefix(value: string): string {
  const normalized = value.replace(/^\/+|\/+$/g, "");
  if (normalized.length === 0 || normalized.length > 255) {
    throw new ObjectStorageSecurityError("S3 prefix must be a bounded opaque path");
  }
  for (const segment of normalized.split("/")) {
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(segment)) {
      throw new ObjectStorageSecurityError("S3 prefix must use opaque lower-case segments");
    }
  }
  return normalized;
}

function bucketName(value: string): string {
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (value.length < 3 || value.length > 255 || value.includes("/") || hasControlCharacter) {
    throw new ObjectStorageSecurityError("S3 bucket is invalid");
  }
  return value;
}

function regionName(value: string): string {
  if (!/^[a-z0-9-]{1,63}$/.test(value)) {
    throw new ObjectStorageSecurityError("S3 region is invalid");
  }
  return value;
}

function endpointUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ObjectStorageSecurityError("S3 endpoint must be a valid HTTPS origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/"
  ) {
    throw new ObjectStorageSecurityError(
      "S3 endpoint must be an HTTPS origin without credentials or a path",
    );
  }
  return parsed.origin;
}

function encryptionConfiguration(value: unknown): S3ServerSideEncryption {
  if (typeof value !== "object" || value === null || !("mode" in value)) {
    throw new ObjectStorageSecurityError("S3 encryption configuration is required");
  }
  const configuration = value as { mode?: unknown; keyId?: unknown };
  if (configuration.mode === "AES256") return { mode: "AES256" };
  if (
    configuration.mode !== "aws:kms" ||
    typeof configuration.keyId !== "string" ||
    configuration.keyId.trim().length === 0 ||
    configuration.keyId.length > 2_000 ||
    [...configuration.keyId].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    throw new ObjectStorageSecurityError("S3 KMS encryption requires a bounded key identifier");
  }
  return { mode: "aws:kms", keyId: configuration.keyId };
}

function digestKey(key: ObjectStorageKey): string {
  assertObjectStorageKey(key);
  return createHash("sha256").update(key).digest("hex");
}

function publicMetadata(metadata: StoredS3Metadata): ObjectMetadata {
  return { ...metadata };
}

function validateExpected(expected: ExpectedObjectMetadata): void {
  try {
    assertContentType(expected.contentType);
  } catch {
    throw new ObjectStorageIntegrityError("Expected object content type is invalid");
  }
  if (
    !Number.isSafeInteger(expected.byteSize) ||
    expected.byteSize < 0 ||
    expected.byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  ) {
    throw new ObjectStorageIntegrityError("Expected object metadata is invalid");
  }
}

function assertExpected(metadata: StoredS3Metadata, expected: ExpectedObjectMetadata): void {
  validateExpected(expected);
  if (
    metadata.contentType !== expected.contentType ||
    metadata.byteSize !== expected.byteSize ||
    metadata.sha256 !== expected.sha256
  ) {
    throw new ObjectStorageIntegrityError("Object metadata does not match the expected object");
  }
}

function metadataFromHeaders(
  key: ObjectStorageKey,
  response: HeadObjectCommandOutput | GetObjectCommandOutput,
  encryption: S3ServerSideEncryption,
  expectedState: string,
): StoredS3Metadata {
  const values = response.Metadata ?? {};
  const contractVersion = values[metadataContractVersion];
  const storedKeyDigest = values[metadataKeyDigest];
  const storedByteSize = values[metadataByteSize];
  const sha256 = values[metadataSha256];
  const contentType = response.ContentType;
  const byteSize = Number(storedByteSize);

  if (
    contractVersion !== OBJECT_STORAGE_CONTRACT_VERSION ||
    storedKeyDigest !== digestKey(key) ||
    values[metadataState] !== expectedState ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 0 ||
    byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    response.ContentLength !== byteSize ||
    response.ServerSideEncryption !== encryption.mode ||
    (encryption.mode === "aws:kms" && response.SSEKMSKeyId !== encryption.keyId)
  ) {
    throw new ObjectStorageIntegrityError("S3 object metadata or encryption is inconsistent");
  }
  try {
    assertContentType(contentType ?? "");
  } catch {
    throw new ObjectStorageIntegrityError("S3 object content type is invalid");
  }
  return {
    contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
    key,
    contentType: contentType as string,
    byteSize,
    sha256,
  };
}

function bytesFromChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === "string") return Buffer.from(chunk);
  throw new ObjectStorageIntegrityError("S3 stream emitted a non-binary chunk");
}

function readableBody(value: unknown): Readable {
  if (value instanceof Readable) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  ) {
    return Readable.from(value as AsyncIterable<Uint8Array>);
  }
  throw new ObjectStorageIntegrityError("S3 response body is unavailable");
}

async function readBoundedSnapshot(
  body: unknown,
  expected: Pick<StoredS3Metadata, "byteSize" | "sha256">,
): Promise<Buffer> {
  const source = readableBody(body);
  const chunks: Buffer[] = [];
  let byteSize = 0;
  try {
    for await (const chunk of source) {
      const bytes = bytesFromChunk(chunk);
      byteSize += bytes.byteLength;
      if (byteSize > expected.byteSize) {
        throw new ObjectStorageIntegrityError("S3 object exceeded its expected byte size");
      }
      chunks.push(bytes);
    }
  } finally {
    if (!source.destroyed) source.destroy();
  }
  const snapshot = Buffer.concat(chunks, byteSize);
  if (
    snapshot.byteLength !== expected.byteSize ||
    createHash("sha256").update(snapshot).digest("hex") !== expected.sha256
  ) {
    throw new ObjectStorageIntegrityError("S3 object checksum does not match metadata");
  }
  return snapshot;
}

function uploadMeter(
  maxBytes: number,
  onChunk: (bytes: Buffer) => void,
): { meter: Transform; byteSize: () => number } {
  let byteSize = 0;
  return {
    meter: new Transform({
      transform(chunk: unknown, encoding: BufferEncoding, callback: TransformCallback): void {
        let bytes: Buffer;
        try {
          bytes = Buffer.isBuffer(chunk)
            ? chunk
            : chunk instanceof Uint8Array
              ? Buffer.from(chunk)
              : typeof chunk === "string"
                ? Buffer.from(chunk, encoding)
                : (() => {
                    throw new ObjectStorageIntegrityError(
                      "The staging stream emitted a non-binary chunk",
                    );
                  })();
          byteSize += bytes.byteLength;
          if (byteSize > maxBytes) throw new ObjectStorageSizeLimitError(maxBytes);
          onChunk(bytes);
          callback(null, bytes);
        } catch (error) {
          callback(error instanceof Error ? error : new ObjectStorageIntegrityError());
        }
      },
    }),
    byteSize: () => byteSize,
  };
}

export class S3ObjectStorage implements ObjectStorage {
  readonly contractVersion = OBJECT_STORAGE_CONTRACT_VERSION;
  readonly #bucket: string;
  readonly #client: Pick<S3Client, "send">;
  readonly #encryption: S3ServerSideEncryption;
  readonly #prefix: string;

  constructor(options: S3ObjectStorageOptions) {
    this.#bucket = bucketName(options.bucket);
    this.#prefix = opaquePrefix(options.prefix);
    const region = regionName(options.region);
    this.#encryption = encryptionConfiguration(options.encryption);
    const endpoint = endpointUrl(options.endpoint);
    if (options.forcePathStyle !== undefined && typeof options.forcePathStyle !== "boolean") {
      throw new ObjectStorageSecurityError("S3 forcePathStyle must be boolean");
    }
    const clientConfig: S3ClientConfig = {
      region,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
    };
    this.#client = options.client ?? new S3Client(clientConfig);
  }

  #objectKey(namespace: "staging" | "objects", key: ObjectStorageKey): string {
    return `${this.#prefix}/${namespace}/${digestKey(key)}`;
  }

  #encryptionHeaders(): Pick<CopyObjectCommandInput, "ServerSideEncryption" | "SSEKMSKeyId"> {
    return this.#encryption.mode === "aws:kms"
      ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: this.#encryption.keyId }
      : { ServerSideEncryption: "AES256" };
  }

  #metadata(key: ObjectStorageKey, byteSize: number, sha256: string, state: string) {
    return {
      [metadataContractVersion]: OBJECT_STORAGE_CONTRACT_VERSION,
      [metadataKeyDigest]: digestKey(key),
      [metadataByteSize]: String(byteSize),
      [metadataSha256]: sha256,
      [metadataState]: state,
    };
  }

  async #headRaw(
    namespace: "staging" | "objects",
    key: ObjectStorageKey,
  ): Promise<HeadObjectCommandOutput | null> {
    try {
      return (await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: this.#objectKey(namespace, key) }),
      )) as HeadObjectCommandOutput;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async #head(
    namespace: "staging" | "objects",
    key: ObjectStorageKey,
  ): Promise<HeadedObject | null> {
    const response = await this.#headRaw(namespace, key);
    if (response === null) return null;
    const metadata = metadataFromHeaders(
      key,
      response,
      this.#encryption,
      namespace === "staging" ? completedStagingState : "final",
    );
    const etag = boundedString(response.ETag, 1_024, "object ETag");
    return { metadata, etag };
  }

  async #getVerified(
    namespace: "staging" | "objects",
    key: ObjectStorageKey,
    expected: ExpectedObjectMetadata,
    headed?: HeadedObject,
  ): Promise<Buffer> {
    const current = headed ?? (await this.#head(namespace, key));
    if (current === null) {
      if (namespace === "staging") throw new StagingObjectNotFoundError();
      throw new ObjectStorageNotFoundError();
    }
    assertExpected(current.metadata, expected);
    let response: GetObjectCommandOutput;
    try {
      response = (await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: this.#objectKey(namespace, key),
          IfMatch: current.etag,
        }),
      )) as GetObjectCommandOutput;
    } catch (error) {
      if (isNotFound(error)) {
        if (namespace === "staging") throw new StagingObjectNotFoundError();
        throw new ObjectStorageNotFoundError();
      }
      if (isPreconditionFailed(error)) {
        throw new ObjectStorageIntegrityError("S3 object changed before its controlled read");
      }
      throw error;
    }
    const responseMetadata = metadataFromHeaders(
      key,
      response,
      this.#encryption,
      namespace === "staging" ? completedStagingState : "final",
    );
    assertExpected(responseMetadata, expected);
    return readBoundedSnapshot(response.Body, responseMetadata);
  }

  async #delete(namespace: "staging" | "objects", key: ObjectStorageKey): Promise<boolean> {
    const existing = await this.#headRaw(namespace, key);
    if (existing === null) return false;
    try {
      await this.#client.send(
        new DeleteObjectCommand({
          Bucket: this.#bucket,
          Key: this.#objectKey(namespace, key),
          IfMatch: boundedString(existing.ETag, 1_024, "object ETag"),
        }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      if (isPreconditionFailed(error)) {
        throw new ObjectStorageIntegrityError("S3 object changed before deletion");
      }
      throw error;
    }
  }

  async putStaging(request: PutStagingRequest): Promise<StagedObjectMetadata> {
    assertObjectStorageKey(request.key);
    assertContentType(request.contentType);
    assertMaxBytes(request.maxBytes);
    if (request.maxBytes > MAX_SYNTHETIC_DOCUMENT_BYTES) {
      throw new ObjectStorageSizeLimitError(MAX_SYNTHETIC_DOCUMENT_BYTES);
    }
    const digest = createHash("sha256");
    const meteredUpload = uploadMeter(request.maxBytes, (bytes) => digest.update(bytes));
    const objectKey = this.#objectKey("staging", request.key);
    const uploadPromise = this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: objectKey,
        Body: meteredUpload.meter,
        ContentType: request.contentType,
        IfNoneMatch: "*",
        Metadata: { [metadataState]: incompleteStagingState },
        ...this.#encryptionHeaders(),
      }),
    );
    try {
      await pipeline(request.body, meteredUpload.meter);
      await uploadPromise;
    } catch (error) {
      await uploadPromise.catch(() => undefined);
      if (isPreconditionFailed(error)) throw new ObjectStorageAlreadyExistsError();
      await this.#delete("staging", request.key).catch(() => undefined);
      throw error;
    }

    try {
      const stagedHead = await this.#headIncompleteStaging(request.key, request.contentType);
      const metadata = this.#metadata(
        request.key,
        meteredUpload.byteSize(),
        digest.digest("hex"),
        completedStagingState,
      );
      await this.#client.send(
        new CopyObjectCommand({
          Bucket: this.#bucket,
          Key: objectKey,
          CopySource: this.#copySource("staging", request.key),
          CopySourceIfMatch: stagedHead.etag,
          MetadataDirective: "REPLACE",
          ContentType: request.contentType,
          Metadata: metadata,
          ...this.#encryptionHeaders(),
        }),
      );
      const sealed = await this.#head("staging", request.key);
      if (sealed === null)
        throw new ObjectStorageIntegrityError("S3 staging object disappeared after upload");
      if (
        sealed.metadata.contentType !== request.contentType ||
        sealed.metadata.sha256 !== metadata[metadataSha256] ||
        sealed.metadata.byteSize !== meteredUpload.byteSize()
      ) {
        throw new ObjectStorageIntegrityError("S3 staging object metadata did not seal correctly");
      }
      await this.#getVerified("staging", request.key, sealed.metadata, sealed);
      return publicMetadata(sealed.metadata);
    } catch (error) {
      await this.#delete("staging", request.key).catch(() => undefined);
      if (isPreconditionFailed(error)) {
        throw new ObjectStorageIntegrityError(
          "S3 staging object changed before its metadata was sealed",
        );
      }
      throw error;
    }
  }

  async #headIncompleteStaging(
    key: ObjectStorageKey,
    contentType: string,
  ): Promise<{ byteSize: number; etag: string }> {
    try {
      const response = await this.#headRaw("staging", key);
      if (response === null) throw new StagingObjectNotFoundError();
      const contentLength = response.ContentLength;
      if (
        typeof contentLength !== "number" ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > MAX_SYNTHETIC_DOCUMENT_BYTES
      ) {
        throw new ObjectStorageIntegrityError(
          "S3 staging object is not a bounded encrypted upload",
        );
      }
      if (
        response.Metadata?.[metadataState] !== incompleteStagingState ||
        response.ContentType !== contentType ||
        response.ServerSideEncryption !== this.#encryption.mode ||
        (this.#encryption.mode === "aws:kms" && response.SSEKMSKeyId !== this.#encryption.keyId)
      ) {
        throw new ObjectStorageIntegrityError(
          "S3 staging object is not a bounded encrypted upload",
        );
      }
      return {
        byteSize: contentLength,
        etag: boundedString(response.ETag, 1_024, "staging object ETag"),
      };
    } catch (error) {
      if (isNotFound(error)) throw new StagingObjectNotFoundError();
      throw error;
    }
  }

  #copySource(namespace: "staging" | "objects", key: ObjectStorageKey): string {
    return `${encodeURIComponent(this.#bucket)}/${this.#objectKey(namespace, key)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  async finalize(
    stagingKey: ObjectStorageKey,
    finalKey: ObjectStorageKey,
  ): Promise<FinalizeObjectResult> {
    assertObjectStorageKey(stagingKey);
    assertObjectStorageKey(finalKey);
    const existing = await this.#head("objects", finalKey);
    if (existing !== null) {
      await this.#getVerified("objects", finalKey, existing.metadata, existing);
      return { status: "already_exists", metadata: publicMetadata(existing.metadata) };
    }

    const staged = await this.#head("staging", stagingKey);
    if (staged === null) throw new StagingObjectNotFoundError();
    await this.#getVerified("staging", stagingKey, staged.metadata, staged);
    const finalMetadata = this.#metadata(
      finalKey,
      staged.metadata.byteSize,
      staged.metadata.sha256,
      "final",
    );
    try {
      await this.#client.send(
        new CopyObjectCommand({
          Bucket: this.#bucket,
          Key: this.#objectKey("objects", finalKey),
          CopySource: this.#copySource("staging", stagingKey),
          CopySourceIfMatch: staged.etag,
          IfNoneMatch: "*",
          MetadataDirective: "REPLACE",
          ContentType: staged.metadata.contentType,
          Metadata: finalMetadata,
          ...this.#encryptionHeaders(),
        }),
      );
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
      const raced = await this.#head("objects", finalKey);
      if (raced !== null) {
        await this.#getVerified("objects", finalKey, raced.metadata, raced);
        return { status: "already_exists", metadata: publicMetadata(raced.metadata) };
      }
      throw new ObjectStorageIntegrityError("S3 object changed before finalization");
    }

    const created = await this.#head("objects", finalKey);
    if (created === null)
      throw new ObjectStorageIntegrityError("S3 final object disappeared after copy");
    await this.#getVerified("objects", finalKey, created.metadata, created);
    return { status: "created", metadata: publicMetadata(created.metadata) };
  }

  async stat(key: ObjectStorageKey): Promise<ObjectMetadata | null> {
    assertObjectStorageKey(key);
    const object = await this.#head("objects", key);
    if (object === null) return null;
    await this.#getVerified("objects", key, object.metadata, object);
    return publicMetadata(object.metadata);
  }

  async exists(key: ObjectStorageKey): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async get(key: ObjectStorageKey, expected: ExpectedObjectMetadata): Promise<ObjectRead> {
    assertObjectStorageKey(key);
    const object = await this.#head("objects", key);
    if (object === null) throw new ObjectStorageNotFoundError();
    const snapshot = await this.#getVerified("objects", key, expected, object);
    return { body: Readable.from([snapshot]), metadata: publicMetadata(object.metadata) };
  }

  async deleteStaging(key: ObjectStorageKey): Promise<boolean> {
    assertObjectStorageKey(key);
    return this.#delete("staging", key);
  }

  async deleteForRecovery(
    key: ObjectStorageKey,
    request: RecoveryDeletionRequest,
  ): Promise<boolean> {
    assertObjectStorageKey(key);
    assertRecoveryDeletionRequest(request);
    return this.#delete("objects", key);
  }
}

export function createS3ObjectStorage(
  options: Omit<S3ObjectStorageOptions, "client">,
): ObjectStorage {
  return new S3ObjectStorage(options);
}
