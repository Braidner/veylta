import type { DirectoryHandleLike } from "./directory-vault";

const databaseName = "veylta-local-authority";
const databaseVersion = 1;
const handleStore = "directory-handles";
const primaryVaultKey = "primary-vault";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, databaseVersion);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(handleStore)) {
      request.result.createObjectStore(handleStore);
    }
  });
  return requestResult(request);
}

function isDirectoryHandle(value: unknown): value is DirectoryHandleLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DirectoryHandleLike>;
  return (
    candidate.kind === "directory" &&
    typeof candidate.name === "string" &&
    typeof candidate.getDirectoryHandle === "function" &&
    typeof candidate.getFileHandle === "function"
  );
}

export async function loadVaultDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(handleStore, "readonly");
    const value: unknown = await requestResult(
      transaction.objectStore(handleStore).get(primaryVaultKey),
    );
    return isDirectoryHandle(value) ? value : null;
  } finally {
    database.close();
  }
}

export async function saveVaultDirectoryHandle(handle: DirectoryHandleLike): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(handleStore, "readwrite");
    await requestResult(transaction.objectStore(handleStore).put(handle, primaryVaultKey));
  } finally {
    database.close();
  }
}

export async function clearVaultDirectoryHandle(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(handleStore, "readwrite");
    await requestResult(transaction.objectStore(handleStore).delete(primaryVaultKey));
  } finally {
    database.close();
  }
}
