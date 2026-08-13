import assert from "node:assert/strict";
import test from "node:test";
import { VEYLTA_VAULT_CONTRACT_VERSION } from "@veylta/contracts";
import {
  type DirectoryHandleLike,
  enqueueAgentScan,
  initializeDirectoryVault,
  readVaultManifest,
} from "./directory-vault";

class MemoryFile {
  bytes = new Uint8Array();

  async getFile(): Promise<Blob> {
    return new Blob([this.bytes], { type: "application/json" });
  }

  async createWritable() {
    return {
      write: async (data: string | Uint8Array) => {
        this.bytes =
          typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      },
      close: async () => undefined,
      abort: async () => undefined,
    };
  }
}

class MemoryDirectory implements DirectoryHandleLike {
  readonly kind = "directory" as const;
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing !== undefined) return existing;
    if (options?.create !== true) throw new DOMException("Missing", "NotFoundError");
    const directory = new MemoryDirectory(name);
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing !== undefined) return existing;
    if (options?.create !== true) throw new DOMException("Missing", "NotFoundError");
    const file = new MemoryFile();
    this.files.set(name, file);
    return file;
  }
}

test("initializes the portable vault once and reopens the same identity", async () => {
  const root = new MemoryDirectory("Veylta Vault");

  const created = await initializeDirectoryVault(root, {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    randomUuid: () => "10000000-0000-4000-8000-000000000001",
  });
  const reopened = await initializeDirectoryVault(root, {
    now: () => new Date("2026-08-13T13:00:00.000Z"),
    randomUuid: () => "10000000-0000-4000-8000-000000000099",
  });

  assert.deepEqual(created, {
    contractVersion: VEYLTA_VAULT_CONTRACT_VERSION,
    vaultId: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-13T12:00:00.000Z",
  });
  assert.deepEqual(reopened, created);
  assert.deepEqual([...root.directories.keys()].sort(), ["agent", "audit", "profiles"]);
  const agent = root.directories.get("agent");
  assert.ok(agent);
  assert.deepEqual([...agent.directories.keys()].sort(), ["commands", "runs"]);
  const commands = agent.directories.get("commands");
  assert.ok(commands);
  assert.deepEqual([...commands.directories.keys()].sort(), [
    "completed",
    "failed",
    "leased",
    "queued",
  ]);
});

test("fails closed instead of replacing an invalid existing root manifest", async () => {
  const root = new MemoryDirectory("Veylta Vault");
  const file = await root.getFileHandle("vault.json", { create: true });
  const writable = await file.createWritable();
  await writable.write('{"contractVersion":"veylta-vault/v99","vaultId":"wrong"}');
  await writable.close();

  await assert.rejects(() => readVaultManifest(root), /unsupported or invalid/i);
  await assert.rejects(() => initializeDirectoryVault(root), /unsupported or invalid/i);
});

test("queues an explicit scan request inside the vault without credentials", async () => {
  const root = new MemoryDirectory("Veylta Vault");
  const manifest = await initializeDirectoryVault(root, {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    randomUuid: () => "10000000-0000-4000-8000-000000000001",
  });

  const record = await enqueueAgentScan(root, manifest, {
    now: () => new Date("2026-08-13T12:05:00.000Z"),
    randomUuid: () => "10000000-0000-4000-8000-000000000002",
  });

  assert.equal(record.state, "queued");
  assert.equal(record.command.type, "scan_unprocessed");
  assert.equal("token" in record, false);
  const queued = root.directories
    .get("agent")
    ?.directories.get("commands")
    ?.directories.get("queued")
    ?.files.get("10000000-0000-4000-8000-000000000002.json");
  assert.ok(queued);
  const persisted = JSON.parse(new TextDecoder().decode(queued.bytes));
  assert.deepEqual(persisted, record);
});
