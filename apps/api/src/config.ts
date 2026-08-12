import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import type { S3ServerSideEncryption } from "./storage/s3-object-storage.js";

function findProjectRoot(start: string): string {
  let candidate = start;
  while (true) {
    if (existsSync(resolve(candidate, "pnpm-workspace.yaml"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("Could not locate the workspace root");
    candidate = parent;
  }
}

const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
const envFile = resolve(projectRoot, ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function optionalBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return boolean(name, false);
}

function origin(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  const parsed = new URL(value);
  if (parsed.origin !== value || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must be an http(s) origin without a path`);
  }
  return value;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function databasePath(): string {
  const configured = process.env.DATABASE_PATH ?? ".local/veylta.sqlite";
  if (configured === ":memory:") {
    throw new Error("DATABASE_PATH must point to a persistent SQLite file");
  }
  return resolve(projectRoot, configured);
}

export type ObjectStorageRuntimeConfig =
  | { mode: "local"; rootPath: string }
  | {
      mode: "s3";
      bucket: string;
      encryption: S3ServerSideEncryption;
      endpoint?: string;
      forcePathStyle?: boolean;
      prefix: string;
      region: string;
    };

function requiredS3Value(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required when OBJECT_STORAGE_DRIVER=s3`);
  }
  return value;
}

function s3Encryption(): S3ServerSideEncryption {
  const mode = requiredS3Value("S3_SERVER_SIDE_ENCRYPTION");
  if (mode === "AES256") {
    if (process.env.S3_KMS_KEY_ID !== undefined) {
      throw new Error("S3_KMS_KEY_ID requires S3_SERVER_SIDE_ENCRYPTION=aws:kms");
    }
    return { mode: "AES256" };
  }
  if (mode === "aws:kms") return { mode, keyId: requiredS3Value("S3_KMS_KEY_ID") };
  throw new Error("S3_SERVER_SIDE_ENCRYPTION must be AES256 or aws:kms");
}

function objectStorage(): ObjectStorageRuntimeConfig {
  const driver = process.env.OBJECT_STORAGE_DRIVER ?? "local";
  if (driver === "local") {
    return {
      mode: "local",
      rootPath: resolve(projectRoot, process.env.OBJECT_STORAGE_ROOT ?? ".local/storage"),
    };
  }
  if (driver !== "s3") {
    throw new Error("OBJECT_STORAGE_DRIVER must be local or s3");
  }
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("S3_ENDPOINT must be an HTTPS origin without a path");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== endpoint) {
      throw new Error("S3_ENDPOINT must be an HTTPS origin without a path");
    }
  }
  const forcePathStyle = optionalBoolean("S3_FORCE_PATH_STYLE");
  return {
    mode: "s3",
    bucket: requiredS3Value("S3_BUCKET"),
    encryption: s3Encryption(),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(forcePathStyle === undefined ? {} : { forcePathStyle }),
    prefix: requiredS3Value("S3_PREFIX"),
    region: requiredS3Value("S3_REGION"),
  };
}

export interface RuntimeConfig {
  apiHost: string;
  apiPort: number;
  databasePath: string;
  demoRegistrationEnabled: boolean;
  maxDocumentBytes: number;
  objectStorage: ObjectStorageRuntimeConfig;
  processingLeaseDurationMs: number;
  processingPollIntervalMs: number;
  processingRetryDelayMs: number;
  secureSessionCookie: boolean;
  sessionTtlSeconds: number;
  webOrigin: string;
  workerHealthHost: string;
  workerHealthPort: number;
}

export function loadConfig(): RuntimeConfig {
  const apiHost = process.env.API_HOST ?? "127.0.0.1";
  const demoRegistrationEnabled = boolean("DEMO_REGISTRATION_ENABLED", false);
  if (demoRegistrationEnabled && !isLoopback(apiHost)) {
    throw new Error("DEMO_REGISTRATION_ENABLED requires a loopback API_HOST");
  }
  const maxDocumentBytes = integer("MAX_DOCUMENT_BYTES", MAX_SYNTHETIC_DOCUMENT_BYTES);
  if (maxDocumentBytes > MAX_SYNTHETIC_DOCUMENT_BYTES) {
    throw new Error(`MAX_DOCUMENT_BYTES must not exceed ${MAX_SYNTHETIC_DOCUMENT_BYTES}`);
  }

  return {
    apiHost,
    apiPort: integer("API_PORT", 4301),
    databasePath: databasePath(),
    demoRegistrationEnabled,
    maxDocumentBytes,
    objectStorage: objectStorage(),
    processingLeaseDurationMs: integer("PROCESSING_LEASE_DURATION_MS", 60_000),
    processingPollIntervalMs: integer("PROCESSING_POLL_INTERVAL_MS", 500),
    processingRetryDelayMs: integer("PROCESSING_RETRY_DELAY_MS", 1_000),
    secureSessionCookie: boolean("SESSION_COOKIE_SECURE", false),
    sessionTtlSeconds: integer("SESSION_TTL_SECONDS", 2_592_000),
    webOrigin: origin("WEB_ORIGIN", "http://127.0.0.1:4300"),
    workerHealthHost: process.env.WORKER_HEALTH_HOST ?? "127.0.0.1",
    workerHealthPort: integer("WORKER_HEALTH_PORT", 4302),
  };
}
