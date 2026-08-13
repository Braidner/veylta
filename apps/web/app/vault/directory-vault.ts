import { VEYLTA_VAULT_CONTRACT_VERSION, type VeyltaVaultManifest } from "@veylta/contracts";

const maximumManifestBytes = 16 * 1024;
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface WritableFileLike {
  write(data: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FileHandleLike {
  readonly kind?: "file";
  readonly name?: string;
  getFile(): Promise<Blob>;
  createWritable(): Promise<WritableFileLike>;
}

export interface DirectoryHandleLike {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<FileHandleLike>;
  queryPermission?(descriptor?: { readonly mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: {
    readonly mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
}

export class VaultFormatError extends Error {
  constructor() {
    super("Vault manifest is unsupported or invalid");
    this.name = "VaultFormatError";
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function isVaultManifest(value: unknown): value is VeyltaVaultManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "contractVersion,createdAt,vaultId") return false;
  if (candidate.contractVersion !== VEYLTA_VAULT_CONTRACT_VERSION) return false;
  if (typeof candidate.vaultId !== "string" || !canonicalUuid.test(candidate.vaultId)) return false;
  if (typeof candidate.createdAt !== "string") return false;
  const parsedDate = new Date(candidate.createdAt);
  return !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString() === candidate.createdAt;
}

export async function readVaultManifest(
  directory: DirectoryHandleLike,
): Promise<VeyltaVaultManifest | null> {
  let handle: FileHandleLike;
  try {
    handle = await directory.getFileHandle("vault.json");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  const file = await handle.getFile();
  if (file.size === 0 || file.size > maximumManifestBytes) throw new VaultFormatError();

  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (!isVaultManifest(parsed)) throw new VaultFormatError();
    return parsed;
  } catch (error) {
    if (error instanceof VaultFormatError) throw error;
    throw new VaultFormatError();
  }
}

async function createLayout(directory: DirectoryHandleLike): Promise<void> {
  const profiles = await directory.getDirectoryHandle("profiles", { create: true });
  void profiles;
  const agent = await directory.getDirectoryHandle("agent", { create: true });
  const commands = await agent.getDirectoryHandle("commands", { create: true });
  await Promise.all([
    commands.getDirectoryHandle("queued", { create: true }),
    commands.getDirectoryHandle("completed", { create: true }),
    commands.getDirectoryHandle("failed", { create: true }),
    agent.getDirectoryHandle("runs", { create: true }),
    directory.getDirectoryHandle("audit", { create: true }),
  ]);
}

async function writeNewManifest(
  directory: DirectoryHandleLike,
  manifest: VeyltaVaultManifest,
): Promise<void> {
  const handle = await directory.getFileHandle("vault.json", { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(`${JSON.stringify(manifest, null, 2)}\n`);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}

export interface InitializeDirectoryVaultOptions {
  readonly now?: () => Date;
  readonly randomUuid?: () => string;
}

export async function initializeDirectoryVault(
  directory: DirectoryHandleLike,
  options: InitializeDirectoryVaultOptions = {},
): Promise<VeyltaVaultManifest> {
  const existing = await readVaultManifest(directory);
  if (existing !== null) return existing;

  const now = options.now ?? (() => new Date());
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const manifest: VeyltaVaultManifest = {
    contractVersion: VEYLTA_VAULT_CONTRACT_VERSION,
    vaultId: randomUuid(),
    createdAt: now().toISOString(),
  };
  if (!isVaultManifest(manifest)) throw new VaultFormatError();

  await createLayout(directory);
  await writeNewManifest(directory, manifest);
  return manifest;
}
