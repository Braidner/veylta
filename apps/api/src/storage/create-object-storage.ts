import type { ObjectStorageRuntimeConfig } from "../config.js";
import { createLocalObjectStorage } from "./local-object-storage.js";
import type { ObjectStorage } from "./object-storage.js";
import { createS3ObjectStorage } from "./s3-object-storage.js";

export function createObjectStorage(config: ObjectStorageRuntimeConfig): ObjectStorage {
  if (config.mode === "local") return createLocalObjectStorage(config.rootPath);
  return createS3ObjectStorage(config);
}
