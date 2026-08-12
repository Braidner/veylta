import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { defineObjectStorageContract } from "./object-storage.contract.js";
import { S3ObjectStorage, type S3ObjectStorageOptions } from "./s3-object-storage.js";

interface StoredS3Object {
  body: Buffer;
  contentType: string | undefined;
  encryption: string | undefined;
  etag: string;
  kmsKeyId: string | undefined;
  metadata: Record<string, string>;
}

function s3Failure(
  name: string,
  statusCode: number,
): Error & { $metadata: { httpStatusCode: number } } {
  const error = new Error(name) as Error & { $metadata: { httpStatusCode: number } };
  error.name = name;
  error.$metadata = { httpStatusCode: statusCode };
  return error;
}

async function bodyBytes(value: unknown): Promise<Buffer> {
  if (value === undefined || value === null) return Buffer.alloc(0);
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (!(value instanceof Readable)) throw new TypeError("Expected a readable S3 request body");
  const chunks: Buffer[] = [];
  for await (const chunk of value) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

class InMemoryS3Client {
  readonly objects = new Map<string, StoredS3Object>();
  readonly writes: Array<Record<string, unknown>> = [];
  #version = 0;

  #address(bucket: string | undefined, key: string | undefined): string {
    if (bucket === undefined || key === undefined)
      throw new TypeError("S3 bucket and key are required");
    return `${bucket}/${key}`;
  }

  #etag(object: Omit<StoredS3Object, "etag">): string {
    this.#version += 1;
    return `"${createHash("sha256")
      .update(object.body)
      .update(JSON.stringify(object.metadata))
      .update(String(this.#version))
      .digest("hex")}"`;
  }

  #head(object: StoredS3Object) {
    return {
      ContentLength: object.body.byteLength,
      ContentType: object.contentType,
      ETag: object.etag,
      Metadata: { ...object.metadata },
      SSEKMSKeyId: object.kmsKeyId,
      ServerSideEncryption: object.encryption,
    };
  }

  rawObject(suffix: string): StoredS3Object {
    const match = [...this.objects.entries()].find(([address]) => address.includes(suffix));
    if (match === undefined) throw new Error(`Missing fake object ${suffix}`);
    return match[1];
  }

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      const input = command.input;
      const address = this.#address(input.Bucket, input.Key);
      if (input.IfNoneMatch === "*" && this.objects.has(address)) {
        throw s3Failure("PreconditionFailed", 412);
      }
      const object = {
        body: await bodyBytes(input.Body),
        contentType: input.ContentType,
        encryption: input.ServerSideEncryption,
        kmsKeyId: input.SSEKMSKeyId,
        metadata: { ...(input.Metadata ?? {}) },
      };
      const stored = { ...object, etag: this.#etag(object) };
      this.objects.set(address, stored);
      this.writes.push({ kind: "put", ...input });
      return { ETag: stored.etag };
    }
    if (command instanceof CopyObjectCommand) {
      const input = command.input;
      const destination = this.#address(input.Bucket, input.Key);
      if (input.IfNoneMatch === "*" && this.objects.has(destination)) {
        throw s3Failure("PreconditionFailed", 412);
      }
      if (input.CopySource === undefined) throw new TypeError("CopySource is required");
      const decoded = decodeURIComponent(input.CopySource);
      const separator = decoded.indexOf("/");
      const source = this.objects.get(decoded);
      if (separator < 1 || source === undefined) throw s3Failure("NoSuchKey", 404);
      if (input.CopySourceIfMatch !== undefined && input.CopySourceIfMatch !== source.etag) {
        throw s3Failure("PreconditionFailed", 412);
      }
      const object = {
        body: Buffer.from(source.body),
        contentType: input.ContentType ?? source.contentType,
        encryption: input.ServerSideEncryption,
        kmsKeyId: input.SSEKMSKeyId,
        metadata: { ...(input.MetadataDirective === "REPLACE" ? input.Metadata : source.metadata) },
      };
      const stored = { ...object, etag: this.#etag(object) };
      this.objects.set(destination, stored);
      this.writes.push({ kind: "copy", ...input });
      return { CopyObjectResult: { ETag: stored.etag } };
    }
    if (command instanceof HeadObjectCommand) {
      const input = command.input;
      const object = this.objects.get(this.#address(input.Bucket, input.Key));
      if (object === undefined) throw s3Failure("NotFound", 404);
      return this.#head(object);
    }
    if (command instanceof GetObjectCommand) {
      const input = command.input;
      const object = this.objects.get(this.#address(input.Bucket, input.Key));
      if (object === undefined) throw s3Failure("NoSuchKey", 404);
      if (input.IfMatch !== undefined && input.IfMatch !== object.etag) {
        throw s3Failure("PreconditionFailed", 412);
      }
      return { ...this.#head(object), Body: Readable.from([object.body]) };
    }
    if (command instanceof DeleteObjectCommand) {
      const input = command.input;
      this.objects.delete(this.#address(input.Bucket, input.Key));
      return {};
    }
    throw new TypeError("Unsupported fake S3 command");
  }
}

function options(client: InMemoryS3Client): S3ObjectStorageOptions {
  return {
    bucket: "veylta-synthetic-fixtures",
    client: client as unknown as S3Client,
    encryption: { mode: "aws:kms", keyId: "arn:aws:kms:eu-west-1:000000000000:key/test" },
    prefix: "veylta-test",
    region: "eu-west-1",
  };
}

defineObjectStorageContract("S3ObjectStorage", async () => {
  const client = new InMemoryS3Client();
  return {
    storage: new S3ObjectStorage(options(client)),
    reopen: () => new S3ObjectStorage(options(client)),
    cleanup: async () => undefined,
  };
});

test("S3ObjectStorage requires confirmed server-side encryption and checksum-verifies a controlled read", async () => {
  const client = new InMemoryS3Client();
  assert.throws(
    () => new S3ObjectStorage({ ...options(client), encryption: undefined as never }),
    /encryption configuration/i,
  );

  const storage = new S3ObjectStorage(options(client));
  const stagingKey = "staging/verified_read" as Parameters<typeof storage.putStaging>[0]["key"];
  const finalKey = "family_01/sha256_verified_read" as Parameters<typeof storage.finalize>[1];
  const staged = await storage.putStaging({
    key: stagingKey,
    body: Readable.from(["immutable"]),
    contentType: "application/pdf",
    maxBytes: 1024,
  });
  await storage.finalize(staged.key, finalKey);

  const writes = client.writes.filter((write) => write.kind === "put" || write.kind === "copy");
  assert.equal(
    writes.every((write) => write.ServerSideEncryption === "aws:kms"),
    true,
  );
  for (const [address, object] of client.objects) {
    assert.equal(address.includes("family_01"), false);
    assert.equal(
      Object.values(object.metadata).some((value) => value.includes("family_01")),
      false,
    );
  }
  assert.equal(
    writes.every((write) => write.SSEKMSKeyId === "arn:aws:kms:eu-west-1:000000000000:key/test"),
    true,
  );

  const finalObject = client.rawObject("/objects/");
  finalObject.body = Buffer.from("mutated!!");
  await assert.rejects(storage.stat(finalKey), { name: "ObjectStorageIntegrityError" });
  await assert.rejects(storage.get(finalKey, staged), { name: "ObjectStorageIntegrityError" });
});
