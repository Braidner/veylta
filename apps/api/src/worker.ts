import { createServer } from "node:http";
import { type HealthStatus, HTTP_API_VERSION } from "@veylta/contracts";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database/pool.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);
let ready = false;
let stopping = false;

async function probe(): Promise<void> {
  try {
    await database.check();
    ready = true;
  } catch {
    ready = false;
  }
}

const timer = setInterval(() => void probe(), 5_000);
timer.unref();
await probe();

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
  clearInterval(timer);
  console.log(JSON.stringify({ service: "worker", signal, status: "stopping" }));
  server.close();
  await database.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

server.listen(config.workerHealthPort, config.workerHealthHost, () => {
  console.log(
    JSON.stringify({
      service: "worker",
      status: "listening",
      port: config.workerHealthPort,
    }),
  );
});
