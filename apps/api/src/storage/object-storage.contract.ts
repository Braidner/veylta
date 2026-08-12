import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createObjectStorageKey,
  type ObjectStorage,
  type ObjectStorageKey,
  ObjectStorageSizeLimitError,
} from "./object-storage.js";

export interface ObjectStorageContractHarness {
  storage: ObjectStorage;
  reopen(): ObjectStorage;
  cleanup(): Promise<void>;
}

export type ObjectStorageContractHarnessFactory = () => Promise<ObjectStorageContractHarness>;

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withHarness(
  factory: ObjectStorageContractHarnessFactory,
  operation: (harness: ObjectStorageContractHarness) => Promise<void>,
): Promise<void> {
  const harness = await factory();
  try {
    await operation(harness);
  } finally {
    await harness.cleanup();
  }
}

const firstKey = createObjectStorageKey("family_01/document_01");

function stagingKey(index: number): ObjectStorageKey {
  return createObjectStorageKey(`staging/upload_${index}`);
}

export function defineObjectStorageContract(
  adapterName: string,
  factory: ObjectStorageContractHarnessFactory,
): void {
  test(`${adapterName}: stages a stream and exposes metadata only after finalization`, async () => {
    await withHarness(factory, async ({ storage }) => {
      const chunks = [Buffer.from("synthetic "), Buffer.from("medical document")];
      const staged = await storage.putStaging({
        key: stagingKey(1),
        body: Readable.from(chunks),
        contentType: "application/pdf",
        maxBytes: 1024,
      });

      assert.equal(staged.contractVersion, "object-storage/v1");
      assert.equal(staged.byteSize, 26);
      assert.equal(staged.sha256, createHash("sha256").update(Buffer.concat(chunks)).digest("hex"));
      assert.equal(await storage.exists(firstKey), false);
      assert.equal(await storage.stat(firstKey), null);

      const finalized = await storage.finalize(staged.key, firstKey);

      assert.equal(finalized.status, "created");
      assert.deepEqual(finalized.metadata, {
        contractVersion: "object-storage/v1",
        key: firstKey,
        contentType: "application/pdf",
        byteSize: 26,
        sha256: staged.sha256,
      });
      assert.equal(await storage.exists(firstKey), true);
      const stored = await storage.get(firstKey, finalized.metadata);
      assert.deepEqual(stored.metadata, finalized.metadata);
      assert.equal(await streamText(stored.body), "synthetic medical document");
    });
  });

  test(`${adapterName}: finalized objects are immutable under a concurrent create`, async () => {
    await withHarness(factory, async ({ storage }) => {
      const first = await storage.putStaging({
        key: stagingKey(2),
        body: Readable.from(["first immutable bytes"]),
        contentType: "application/pdf",
        maxBytes: 1024,
      });
      const second = await storage.putStaging({
        key: stagingKey(3),
        body: Readable.from(["replacement bytes"]),
        contentType: "application/pdf",
        maxBytes: 1024,
      });

      const outcomes = await Promise.all([
        storage.finalize(first.key, firstKey),
        storage.finalize(second.key, firstKey),
      ]);
      assert.equal(outcomes.filter(({ status }) => status === "created").length, 1);
      assert.equal(outcomes.filter(({ status }) => status === "already_exists").length, 1);
      const winningMetadata = outcomes[0]?.metadata;
      assert.ok(winningMetadata !== undefined);
      const stored = await storage.get(firstKey, winningMetadata);
      const storedText = await streamText(stored.body);
      assert.ok(storedText === "first immutable bytes" || storedText === "replacement bytes");

      const third = await storage.putStaging({
        key: stagingKey(4),
        body: Readable.from(["must not overwrite"]),
        contentType: "application/pdf",
        maxBytes: 1024,
      });
      const duplicate = await storage.finalize(third.key, firstKey);
      assert.equal(duplicate.status, "already_exists");
      assert.equal(
        await streamText((await storage.get(firstKey, duplicate.metadata)).body),
        storedText,
      );
      assert.equal(await storage.deleteStaging(third.key), true);
    });
  });

  test(`${adapterName}: staging and finalized content survive adapter restarts`, async () => {
    await withHarness(factory, async ({ storage, reopen }) => {
      const staged = await storage.putStaging({
        key: stagingKey(5),
        body: Readable.from(["persistent bytes"]),
        contentType: "application/pdf",
        maxBytes: 1024,
      });
      const restartedBeforeFinalize = reopen();
      const finalized = await restartedBeforeFinalize.finalize(staged.key, firstKey);
      assert.equal(finalized.status, "created");

      const restartedAfterFinalize = reopen();

      const expected = {
        contractVersion: "object-storage/v1",
        key: firstKey,
        contentType: "application/pdf",
        byteSize: 16,
        sha256: createHash("sha256").update("persistent bytes").digest("hex"),
      } as const;
      assert.deepEqual(await restartedAfterFinalize.stat(firstKey), expected);
      assert.equal(
        await streamText((await restartedAfterFinalize.get(firstKey, expected)).body),
        "persistent bytes",
      );
    });
  });

  test(`${adapterName}: deletion is limited to staging cleanup and explicit recovery`, async () => {
    await withHarness(factory, async ({ storage }) => {
      assert.equal("delete" in storage, false);

      const abandoned = await storage.putStaging({
        key: stagingKey(6),
        body: Readable.from(["abandoned"]),
        contentType: "application/pdf",
        maxBytes: 1024,
      });
      assert.equal(await storage.deleteStaging(abandoned.key), true);
      assert.equal(await storage.deleteStaging(abandoned.key), false);

      const accepted = await storage.putStaging({
        key: stagingKey(7),
        body: Readable.from(["accepted"]),
        contentType: "application/pdf",
        maxBytes: 1024,
      });
      await storage.finalize(accepted.key, firstKey);

      await assert.rejects(
        storage.deleteForRecovery(firstKey, {
          intent: "repair_or_recovery",
          reason: "",
        }),
      );
      assert.equal(await storage.exists(firstKey), true);
      assert.equal(
        await storage.deleteForRecovery(firstKey, {
          intent: "repair_or_recovery",
          reason: "test-only orphan repair",
        }),
        true,
      );
      assert.equal(await storage.exists(firstKey), false);
      assert.equal(
        await storage.deleteForRecovery(firstKey, {
          intent: "repair_or_recovery",
          reason: "idempotent recovery retry",
        }),
        false,
      );
    });
  });

  test(`${adapterName}: enforces maxBytes while streaming and leaves no staging object`, async () => {
    await withHarness(factory, async ({ storage }) => {
      const source = Readable.from([Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4)]);

      await assert.rejects(
        storage.putStaging({
          key: stagingKey(8),
          body: source,
          contentType: "application/pdf",
          maxBytes: 10,
        }),
        ObjectStorageSizeLimitError,
      );
      assert.equal(await storage.deleteStaging(stagingKey(8)), false);
    });
  });

  test(`${adapterName}: opaque keys reject paths and filenames`, () => {
    const invalidKeys = [
      "../escape",
      "/absolute",
      "family/../../escape",
      "family//document",
      "lab-result.pdf",
      "Family/document",
      "family\\document",
    ];

    for (const key of invalidKeys) {
      assert.throws(() => createObjectStorageKey(key), { name: "ObjectStorageValidationError" });
    }
  });

  test(`${adapterName}: every operation revalidates branded keys at runtime`, async () => {
    await withHarness(factory, async ({ storage }) => {
      const forged = "../escape" as ObjectStorageKey;
      await assert.rejects(storage.exists(forged), { name: "ObjectStorageValidationError" });
      await assert.rejects(storage.stat(forged), { name: "ObjectStorageValidationError" });
      await assert.rejects(
        storage.get(forged, {
          contentType: "application/pdf",
          byteSize: 1,
          sha256: "0".repeat(64),
        }),
        { name: "ObjectStorageValidationError" },
      );
    });
  });
}
