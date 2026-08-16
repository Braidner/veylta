import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { type HealthStatus, HTTP_API_VERSION } from "@veylta/contracts";
import { documentExecutionProfile } from "./codex/codex-execution-profile.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database/pool.js";
import { createCodexDocumentIntelligenceProvider } from "./processing/codex-document-intelligence-provider.js";
import { createDocumentExtractionProcessor } from "./processing/document-extraction-processor.js";
import { createCodexPreferencesStore } from "./settings/codex-preferences.js";
import { createStorageController } from "./storage/storage-controller.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);
const storage = createStorageController(database, config.objectStorage);
await storage.initialize();
const codexPreferences = createCodexPreferencesStore(database, config.codexDefaultPreference);
const processor = createDocumentExtractionProcessor({
  database,
  storage,
  intelligence: createCodexDocumentIntelligenceProvider({
    resolveExecutionProfile: async () => documentExecutionProfile(await codexPreferences.get()),
    timeoutMs: config.codexDocumentTimeoutMs,
  }),
});
const workerId = randomUUID();
let ready = false;
let stopping = false;
let activeProcessing: Promise<void> | null = null;

async function probe(): Promise<void> {
  try {
    await database.check();
    ready = true;
  } catch {
    ready = false;
  }
}

function logProcessingResult(result: Awaited<ReturnType<typeof processor.processNext>>): void {
  if (result.status === "idle") return;
  const errorCode = "errorCode" in result ? result.errorCode : undefined;
  console.log(
    JSON.stringify({
      service: "worker",
      event: "document_processing",
      status: result.status,
      ...(errorCode === undefined ? {} : { errorCode }),
    }),
  );
}

/** Aborted on shutdown so an in-flight run is handed back instead of idling as a stale lease. */
const shutdownController = new AbortController();

async function processAvailableDocument(): Promise<void> {
  try {
    logProcessingResult(
      await processor.processNext({
        workerId,
        leaseDurationMs: config.processingLeaseDurationMs,
        retryDelayMs: config.processingRetryDelayMs,
        abortSignal: shutdownController.signal,
      }),
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code).slice(0, 64)
        : undefined;
    console.error(
      JSON.stringify({
        service: "worker",
        event: "document_processing",
        status: "unexpected_failure",
        errorName,
        ...(errorCode === undefined ? {} : { errorCode }),
      }),
    );
  }
}

function scheduleProcessing(): void {
  if (stopping || !ready || activeProcessing !== null) return;
  activeProcessing = processAvailableDocument().finally(() => {
    activeProcessing = null;
  });
}

const readinessTimer = setInterval(() => void probe(), 5_000);
const processingTimer = setInterval(scheduleProcessing, config.processingPollIntervalMs);
readinessTimer.unref();
processingTimer.unref();
await probe();
scheduleProcessing();

const server = createServer((request, response) => {
  const readinessRequest = request.url === "/readyz";
  const status: HealthStatus = {
    status: readinessRequest && !ready ? "unavailable" : "ok",
    service: "worker",
    version: HTTP_API_VERSION,
  };
  response.writeHead(status.status === "ok" ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(status));
});

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  ready = false;
  clearInterval(readinessTimer);
  clearInterval(processingTimer);
  console.log(JSON.stringify({ service: "worker", signal, status: "stopping" }));
  // Do not wait out a model call that may take minutes: kill it and release the lease now.
  shutdownController.abort();
  await activeProcessing;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.close();
}

function requestShutdown(signal: "SIGINT" | "SIGTERM"): void {
  void shutdown(signal).catch(() => {
    console.error(JSON.stringify({ service: "worker", status: "shutdown_failed" }));
    process.exitCode = 1;
  });
}

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

server.listen(config.workerHealthPort, config.workerHealthHost, () => {
  console.log(
    JSON.stringify({
      service: "worker",
      status: "listening",
      port: config.workerHealthPort,
    }),
  );
});
