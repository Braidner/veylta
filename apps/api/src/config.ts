import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { MAX_SYNTHETIC_PDF_BYTES } from "@veylta/contracts";

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
  const parsed = Number.parseInt(value, 10);
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

export interface RuntimeConfig {
  apiHost: string;
  apiPort: number;
  databasePath: string;
  demoRegistrationEnabled: boolean;
  maxPdfBytes: number;
  objectStorageRoot: string;
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
  const maxPdfBytes = integer("MAX_PDF_BYTES", MAX_SYNTHETIC_PDF_BYTES);
  if (maxPdfBytes > MAX_SYNTHETIC_PDF_BYTES) {
    throw new Error(`MAX_PDF_BYTES must not exceed ${MAX_SYNTHETIC_PDF_BYTES}`);
  }

  return {
    apiHost,
    apiPort: integer("API_PORT", 4301),
    databasePath: databasePath(),
    demoRegistrationEnabled,
    maxPdfBytes,
    objectStorageRoot: resolve(projectRoot, process.env.OBJECT_STORAGE_ROOT ?? ".local/storage"),
    secureSessionCookie: boolean("SESSION_COOKIE_SECURE", false),
    sessionTtlSeconds: integer("SESSION_TTL_SECONDS", 2_592_000),
    webOrigin: origin("WEB_ORIGIN", "http://127.0.0.1:4300"),
    workerHealthHost: process.env.WORKER_HEALTH_HOST ?? "127.0.0.1",
    workerHealthPort: integer("WORKER_HEALTH_PORT", 4302),
  };
}
