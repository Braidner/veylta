import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { LocalObjectStorage } from "./local-object-storage.js";
import { defineObjectStorageContract } from "./object-storage.contract.js";
import { createObjectStorageKey, ObjectStorageSecurityError } from "./object-storage.js";

async function createTemporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "veylta-object-storage-"));
}

async function streamToText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

defineObjectStorageContract("LocalObjectStorage", async () => {
  const rootPath = await createTemporaryRoot();
  return {
    storage: new LocalObjectStorage({ rootPath }),
    reopen: () => new LocalObjectStorage({ rootPath }),
    cleanup: async () => rm(rootPath, { recursive: true, force: true }),
  };
});

test("local adapter never uses the opaque object key as a filesystem path", async () => {
  const rootPath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const key = createObjectStorageKey("family_secret/document_secret");
    const staged = await storage.putStaging({
      key: createObjectStorageKey("staging/opaque_path_test"),
      body: Readable.from(["opaque"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    await storage.finalize(staged.key, key);

    const paths = await readdir(rootPath, { recursive: true });
    assert.equal(
      paths.some((path) => path.includes("family_secret")),
      false,
    );
    assert.equal(
      paths.some((path) => path.includes("document_secret")),
      false,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("local adapter removes an incomplete staging object when its source fails", async () => {
  const rootPath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const failingSource = Readable.from(
      (async function* source(): AsyncGenerator<Buffer> {
        yield Buffer.alloc(64 * 1024, 1);
        throw new Error("synthetic source failure");
      })(),
    );

    await assert.rejects(
      storage.putStaging({
        key: createObjectStorageKey("staging/source_failure"),
        body: failingSource,
        contentType: "application/pdf",
        maxBytes: 1024 * 1024,
      }),
      /synthetic source failure/,
    );
    const stagingPrefixes = await readdir(join(rootPath, "staging"));
    for (const prefix of stagingPrefixes) {
      assert.deepEqual(await readdir(join(rootPath, "staging", prefix)), []);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("local adapter resumes finalization after a metadata-transition crash", async () => {
  const rootPath = await createTemporaryRoot();
  try {
    const stagingKey = createObjectStorageKey("staging/recovery_window");
    const finalKey = createObjectStorageKey("family_04/sha256_recovery_window");
    const storage = new LocalObjectStorage({ rootPath });
    await storage.putStaging({
      key: stagingKey,
      body: Readable.from(["recoverable"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });

    const stagingDigest = createHash("sha256").update(stagingKey).digest("hex");
    const metadataPath = join(
      rootPath,
      "staging",
      stagingDigest.slice(0, 2),
      stagingDigest,
      "metadata.json",
    );
    const transitionedMetadata = (await readFile(metadataPath, "utf8")).replace(
      stagingKey,
      finalKey,
    );
    await writeFile(metadataPath, transitionedMetadata);

    const restarted = new LocalObjectStorage({ rootPath });
    const finalized = await restarted.finalize(stagingKey, finalKey);

    assert.equal(finalized.status, "created");
    assert.equal(finalized.metadata.key, finalKey);
    assert.equal(
      await streamToText((await restarted.get(finalKey, finalized.metadata)).body),
      "recoverable",
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("local adapter rejects a staging-base symlink escape", async () => {
  const rootPath = await createTemporaryRoot();
  const outsidePath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const staged = await storage.putStaging({
      key: createObjectStorageKey("staging/symlink_base_setup"),
      body: Readable.from(["initialize layout"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    await storage.deleteStaging(staged.key);
    await rm(join(rootPath, "staging"), { recursive: true });
    await symlink(outsidePath, join(rootPath, "staging"));

    await assert.rejects(
      storage.putStaging({
        key: createObjectStorageKey("staging/symlink_escape"),
        body: Readable.from(["escape"]),
        contentType: "application/pdf",
        maxBytes: 1024,
      }),
      ObjectStorageSecurityError,
    );
    assert.deepEqual(await readdir(outsidePath), []);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test("local adapter rejects a symlink at a final object location", async () => {
  const rootPath = await createTemporaryRoot();
  const outsidePath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const key = createObjectStorageKey("family_02/document_02");
    const staged = await storage.putStaging({
      key: createObjectStorageKey("staging/final_symlink"),
      body: Readable.from(["must stay inside root"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    const digest = createHash("sha256").update(key).digest("hex");
    const objectParent = join(rootPath, "objects", digest.slice(0, 2));
    await mkdir(objectParent);
    await symlink(outsidePath, join(objectParent, digest));

    await assert.rejects(storage.finalize(staged.key, key), ObjectStorageSecurityError);
    assert.deepEqual(await readdir(outsidePath), []);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test("local adapter refuses to follow a replaced payload symlink", async () => {
  const rootPath = await createTemporaryRoot();
  const outsidePath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const key = createObjectStorageKey("family_03/document_03");
    const staged = await storage.putStaging({
      key: createObjectStorageKey("staging/payload_symlink"),
      body: Readable.from(["original"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    const finalized = await storage.finalize(staged.key, key);
    const digest = createHash("sha256").update(key).digest("hex");
    const payloadPath = join(rootPath, "objects", digest.slice(0, 2), digest, "payload");
    const outsideFile = join(outsidePath, "outside");
    await writeFile(outsideFile, "outside secret");
    await unlink(payloadPath);
    await symlink(outsideFile, payloadPath);

    await assert.rejects(storage.stat(key), ObjectStorageSecurityError);
    await assert.rejects(storage.get(key, finalized.metadata), ObjectStorageSecurityError);
    assert.equal(await readFile(outsideFile, "utf8"), "outside secret");
    assert.equal((await lstat(payloadPath)).isSymbolicLink(), true);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test("local adapter rejects same-size payload mutation by checksum", async () => {
  const rootPath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const key = createObjectStorageKey("family_04/document_04");
    const staged = await storage.putStaging({
      key: createObjectStorageKey("staging/checksum_mutation"),
      body: Readable.from(["original"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    const finalized = await storage.finalize(staged.key, key);
    const digest = createHash("sha256").update(key).digest("hex");
    const payloadPath = join(rootPath, "objects", digest.slice(0, 2), digest, "payload");
    await writeFile(payloadPath, "mutated!", { mode: 0o600 });

    await assert.rejects(storage.stat(key), { name: "ObjectStorageIntegrityError" });
    await assert.rejects(storage.get(key, finalized.metadata), {
      name: "ObjectStorageIntegrityError",
    });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("local adapter returns the exact snapshot it verified", async () => {
  const rootPath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const key = createObjectStorageKey("family_05/document_05");
    const staged = await storage.putStaging({
      key: createObjectStorageKey("staging/verified_handle"),
      body: Readable.from(["original"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    const finalized = await storage.finalize(staged.key, key);

    const stored = await storage.get(key, finalized.metadata);
    const digest = createHash("sha256").update(key).digest("hex");
    const payloadPath = join(rootPath, "objects", digest.slice(0, 2), digest, "payload");
    await writeFile(payloadPath, "mutated!", { mode: 0o600 });

    assert.equal(await streamToText(stored.body), "original");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("local adapter rejects oversized replacement metadata before opening its payload", async () => {
  const rootPath = await createTemporaryRoot();
  try {
    const storage = new LocalObjectStorage({ rootPath });
    const key = createObjectStorageKey("family_06/document_06");
    const staged = await storage.putStaging({
      key: createObjectStorageKey("staging/bounded_expected_read"),
      body: Readable.from(["original"]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    const finalized = await storage.finalize(staged.key, key);
    const digest = createHash("sha256").update(key).digest("hex");
    const container = join(rootPath, "objects", digest.slice(0, 2), digest);
    const payloadPath = join(container, "payload");
    const metadataPath = join(container, "metadata.json");
    const replacement = Buffer.alloc(6 * 1024 * 1024, 1);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      byteSize: number;
      sha256: string;
    };
    metadata.byteSize = replacement.byteLength;
    metadata.sha256 = createHash("sha256").update(replacement).digest("hex");
    await writeFile(payloadPath, replacement, { mode: 0o600 });
    await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });

    await assert.rejects(storage.get(key, finalized.metadata), {
      name: "ObjectStorageIntegrityError",
    });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
