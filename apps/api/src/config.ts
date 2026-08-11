import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export interface RuntimeConfig {
  apiHost: string;
  apiPort: number;
  databaseUrl: string;
  objectStorageRoot: string;
  workerHealthHost: string;
  workerHealthPort: number;
}

export function loadConfig(): RuntimeConfig {
  return {
    apiHost: process.env.API_HOST ?? "127.0.0.1",
    apiPort: integer("API_PORT", 4301),
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgresql://family_health:family_health@127.0.0.1:5432/family_health",
    objectStorageRoot: process.env.OBJECT_STORAGE_ROOT ?? `${projectRoot}.local/storage`,
    workerHealthHost: process.env.WORKER_HEALTH_HOST ?? "127.0.0.1",
    workerHealthPort: integer("WORKER_HEALTH_PORT", 4302),
  };
}
