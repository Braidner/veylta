import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { type HealthStatus, HTTP_API_VERSION } from "@veylta/contracts";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database/pool.js";
import { createDocumentExtractionProcessor } from "./processing/document-extraction-processor.js";
import { createObjectStorage } from "./storage/create-object-storage.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);
const processor = createDocumentExtractionProcessor({
  database,
  storage: createObjectStorage(config.objectStorage),
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

async function processAvailableDocument(): Promise<void> {
  try {
    logProcessingResult(
      await processor.processNext({
        workerId,
        leaseDurationMs: config.processingLeaseDurationMs,
        retryDelayMs: config.processingRetryDelayMs,
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        service: "worker",
        event: "document_processing",
        status: "unexpected_failure",
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
