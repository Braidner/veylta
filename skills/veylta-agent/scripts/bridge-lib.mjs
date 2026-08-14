import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const vaultContractVersion = "veylta-vault/v1";
const protocolVersion = "veylta-agent/v1";
const maximumJsonBytes = 16 * 1024;
const maximumWaitMs = 30_000;
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = /^[a-f0-9]{64}$/;
const workerIdPattern = /^[A-Za-z0-9._-]{1,64}$/;
const safeFailureCode = /^[A-Z][A-Z0-9_]{0,63}$/;

export class AgentBridgeError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "AgentBridgeError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function hasExactKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalIsoDate(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isAgentCommand(value, expectedVaultId) {
  if (!isRecord(value)) return false;
  const baseKeys = ["protocolVersion", "id", "type", "vaultId", "requestedAt"];
  if (value.type === "scan_unprocessed") {
    if (!hasExactKeys(value, baseKeys, ["profileId"])) return false;
    if (value.profileId !== undefined && !canonicalUuid.test(value.profileId)) return false;
  } else if (value.type === "analyze_document") {
    if (!hasExactKeys(value, [...baseKeys, "profileId", "documentId", "sourceSha256"])) {
      return false;
    }
    if (!canonicalUuid.test(value.profileId) || !canonicalUuid.test(value.documentId)) return false;
    if (!sha256.test(value.sourceSha256)) return false;
  } else {
    return false;
  }

  return (
    value.protocolVersion === protocolVersion &&
    canonicalUuid.test(value.id) &&
    value.vaultId === expectedVaultId &&
    canonicalUuid.test(value.vaultId) &&
    isCanonicalIsoDate(value.requestedAt)
  );
}

function isQueueRecord(value, expectedVaultId) {
  if (!isRecord(value) || value.protocolVersion !== protocolVersion) return false;
  if (!isAgentCommand(value.command, expectedVaultId)) return false;
  if (!Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0) return false;
  if (!isCanonicalIsoDate(value.queuedAt)) return false;

  if (value.state === "queued") {
    return hasExactKeys(value, ["protocolVersion", "state", "command", "attemptCount", "queuedAt"]);
  }

  if (value.state === "leased") {
    return (
      hasExactKeys(value, [
        "protocolVersion",
        "state",
        "command",
        "attemptCount",
        "queuedAt",
        "workerId",
        "leaseTokenHash",
        "leasedAt",
        "leaseExpiresAt",
      ]) &&
      workerIdPattern.test(value.workerId) &&
      sha256.test(value.leaseTokenHash) &&
      isCanonicalIsoDate(value.leasedAt) &&
      isCanonicalIsoDate(value.leaseExpiresAt)
    );
  }

  if (value.state === "completed") {
    return (
      hasExactKeys(value, [
        "protocolVersion",
        "state",
        "command",
        "attemptCount",
        "queuedAt",
        "completedAt",
      ]) && isCanonicalIsoDate(value.completedAt)
    );
  }

  if (value.state === "failed") {
    return (
      hasExactKeys(value, [
        "protocolVersion",
        "state",
        "command",
        "attemptCount",
        "queuedAt",
        "failedAt",
        "failureCode",
      ]) &&
      isCanonicalIsoDate(value.failedAt) &&
      safeFailureCode.test(value.failureCode)
    );
  }

  return false;
}

async function readBoundedJson(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > maximumJsonBytes) {
    throw new AgentBridgeError("INVALID_VAULT_DATA", "Vault data is invalid");
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumJsonBytes) {
    throw new AgentBridgeError("INVALID_VAULT_DATA", "Vault data is invalid");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new AgentBridgeError("INVALID_VAULT_DATA", "Vault data is invalid");
  }
}

async function readManifest(vaultPath) {
  const value = await readBoundedJson(join(vaultPath, "vault.json"));
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["contractVersion", "vaultId", "createdAt"]) ||
    value.contractVersion !== vaultContractVersion ||
    !canonicalUuid.test(value.vaultId) ||
    !isCanonicalIsoDate(value.createdAt)
  ) {
    throw new AgentBridgeError("INVALID_VAULT", "Vault manifest is unsupported or invalid");
  }
  return value;
}

async function atomicCreateJson(path, value, mode = 0o600) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body) > maximumJsonBytes) {
    throw new AgentBridgeError("RECORD_TOO_LARGE", "Agent record is too large");
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", mode);
  try {
    await handle.writeFile(body, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function atomicReplaceJson(path, value, mode = 0o600) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body) > maximumJsonBytes) {
    throw new AgentBridgeError("RECORD_TOO_LARGE", "Agent record is too large");
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, body, { flag: "wx", mode });
  await rename(temporaryPath, path);
}

function createMutex() {
  let tail = Promise.resolve();
  return async (operation) => {
    const previous = tail;
    let release;
    tail = new Promise((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function tokenHash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeTokenEquals(candidate, expected) {
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
}

function isInside(parentPath, candidatePath) {
  const difference = relative(parentPath, candidatePath);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference))
  );
}

async function canonicalPotentialPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await canonicalPotentialPath(parent), basename(path));
  }
}

async function jsonFiles(path) {
  return (await readdir(path, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        canonicalUuid.test(entry.name.replace(/\.json$/, "")) &&
        entry.name.endsWith(".json"),
    )
    .map((entry) => entry.name)
    .sort();
}

async function assertPrivateVaultDirectory(vaultPath, path) {
  const metadata = await lstat(path);
  const resolvedPath = await realpath(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !isInside(vaultPath, resolvedPath) ||
    resolvedPath !== resolve(path)
  ) {
    throw new AgentBridgeError("UNSAFE_VAULT_LAYOUT", "Vault agent layout is unsafe");
  }
}

export async function createVaultCommandStore({ vaultPath, now = () => new Date() }) {
  const resolvedVaultPath = await realpath(resolve(vaultPath));
  const manifest = await readManifest(resolvedVaultPath);
  const commandsPath = join(resolvedVaultPath, "agent", "commands");
  const paths = {
    queued: join(commandsPath, "queued"),
    leased: join(commandsPath, "leased"),
    completed: join(commandsPath, "completed"),
    failed: join(commandsPath, "failed"),
  };
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  await Promise.all([
    assertPrivateVaultDirectory(resolvedVaultPath, join(resolvedVaultPath, "agent")),
    assertPrivateVaultDirectory(resolvedVaultPath, commandsPath),
    ...Object.values(paths).map((path) => assertPrivateVaultDirectory(resolvedVaultPath, path)),
  ]);
  const withLock = createMutex();

  async function readRecord(path) {
    const value = await readBoundedJson(path);
    const expectedId = basename(path, ".json");
    if (!isQueueRecord(value, manifest.vaultId) || value.command.id !== expectedId) {
      throw new AgentBridgeError("INVALID_QUEUE_RECORD", "Agent queue record is invalid");
    }
    return value;
  }

  async function existingRecord(path) {
    try {
      return await readRecord(path);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  function sameCommand(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async function reconcile(at) {
    const allNames = new Set(
      (await Promise.all(Object.values(paths).map((path) => jsonFiles(path)))).flat(),
    );
    for (const fileName of [...allNames].sort()) {
      const completed = await existingRecord(join(paths.completed, fileName));
      const failed = await existingRecord(join(paths.failed, fileName));
      if (completed !== null && failed !== null) {
        throw new AgentBridgeError("CONFLICTING_TERMINAL_RECORDS", "Agent queue is inconsistent");
      }
      const terminal = completed ?? failed;
      if (terminal !== null) {
        await Promise.all([
          unlink(join(paths.queued, fileName)).catch((error) => {
            if (error?.code !== "ENOENT") throw error;
          }),
          unlink(join(paths.leased, fileName)).catch((error) => {
            if (error?.code !== "ENOENT") throw error;
          }),
        ]);
        continue;
      }

      const leasedPath = join(paths.leased, fileName);
      const record = await existingRecord(leasedPath);
      if (record === null) continue;
      if (record.state !== "leased") {
        throw new AgentBridgeError("INVALID_QUEUE_RECORD", "Agent queue record is invalid");
      }
      const queuedPath = join(paths.queued, fileName);
      const existingQueued = await existingRecord(queuedPath);
      if (existingQueued !== null && !sameCommand(existingQueued.command, record.command)) {
        throw new AgentBridgeError("COMMAND_ID_CONFLICT", "Agent queue is inconsistent");
      }
      if (new Date(record.leaseExpiresAt).valueOf() > at.valueOf()) {
        if (existingQueued !== null) await unlink(queuedPath);
        continue;
      }
      const queued = {
        protocolVersion,
        state: "queued",
        command: record.command,
        attemptCount: record.attemptCount,
        queuedAt: record.queuedAt,
      };
      if (existingQueued === null) await atomicCreateJson(queuedPath, queued);
      else await atomicReplaceJson(queuedPath, queued);
      await unlink(leasedPath);
    }
  }

  return {
    vaultId: manifest.vaultId,
    vaultPath: resolvedVaultPath,
    async enqueue(command) {
      if (!isAgentCommand(command, manifest.vaultId)) {
        throw new AgentBridgeError("INVALID_COMMAND", "Invalid agent command");
      }
      return withLock(async () => {
        const record = {
          protocolVersion,
          state: "queued",
          command,
          attemptCount: 0,
          queuedAt: now().toISOString(),
        };
        try {
          await atomicCreateJson(join(paths.queued, `${command.id}.json`), record);
        } catch (error) {
          if (error?.code === "EEXIST") {
            throw new AgentBridgeError("COMMAND_EXISTS", "Agent command already exists", 409);
          }
          throw error;
        }
        return record;
      });
    },
    async claim(workerId, leaseDurationMs) {
      if (!workerIdPattern.test(workerId)) {
        throw new AgentBridgeError("INVALID_WORKER", "Worker id is invalid");
      }
      if (
        !Number.isSafeInteger(leaseDurationMs) ||
        leaseDurationMs < 250 ||
        leaseDurationMs > 300_000
      ) {
        throw new AgentBridgeError("INVALID_LEASE", "Lease duration is invalid");
      }
      return withLock(async () => {
        const claimedAt = now();
        await reconcile(claimedAt);
        const [fileName] = await jsonFiles(paths.queued);
        if (fileName === undefined) return null;
        const queuedPath = join(paths.queued, fileName);
        const record = await readRecord(queuedPath);
        if (record.state !== "queued") {
          throw new AgentBridgeError("INVALID_QUEUE_RECORD", "Agent queue record is invalid");
        }
        const leaseToken = randomBytes(32).toString("hex");
        const leased = {
          protocolVersion,
          state: "leased",
          command: record.command,
          attemptCount: record.attemptCount + 1,
          queuedAt: record.queuedAt,
          workerId,
          leaseTokenHash: tokenHash(leaseToken),
          leasedAt: claimedAt.toISOString(),
          leaseExpiresAt: new Date(claimedAt.valueOf() + leaseDurationMs).toISOString(),
        };
        await atomicCreateJson(join(paths.leased, fileName), leased);
        await unlink(queuedPath);
        return {
          command: leased.command,
          attempt: leased.attemptCount,
          leaseToken,
          leaseExpiresAt: leased.leaseExpiresAt,
        };
      });
    },
    async complete({ commandId, workerId, leaseToken, outcome, failureCode }) {
      if (
        !canonicalUuid.test(commandId) ||
        !workerIdPattern.test(workerId) ||
        !sha256.test(leaseToken)
      ) {
        throw new AgentBridgeError("INVALID_COMPLETION", "Completion request is invalid");
      }
      if (outcome !== "completed" && outcome !== "failed") {
        throw new AgentBridgeError("INVALID_COMPLETION", "Completion request is invalid");
      }
      if (
        (outcome === "failed") !==
        (typeof failureCode === "string" && safeFailureCode.test(failureCode))
      ) {
        throw new AgentBridgeError("INVALID_COMPLETION", "Completion request is invalid");
      }
      return withLock(async () => {
        const leasedPath = join(paths.leased, `${commandId}.json`);
        let record;
        try {
          record = await readRecord(leasedPath);
        } catch (error) {
          if (error?.code === "ENOENT") {
            throw new AgentBridgeError(
              "LEASE_CONFLICT",
              "Lease no longer belongs to this worker",
              409,
            );
          }
          throw error;
        }
        if (
          record.state !== "leased" ||
          record.workerId !== workerId ||
          !safeTokenEquals(record.leaseTokenHash, tokenHash(leaseToken)) ||
          new Date(record.leaseExpiresAt).valueOf() <= now().valueOf()
        ) {
          throw new AgentBridgeError(
            "LEASE_CONFLICT",
            "Lease no longer belongs to this worker",
            409,
          );
        }
        const terminal =
          outcome === "completed"
            ? {
                protocolVersion,
                state: "completed",
                command: record.command,
                attemptCount: record.attemptCount,
                queuedAt: record.queuedAt,
                completedAt: now().toISOString(),
              }
            : {
                protocolVersion,
                state: "failed",
                command: record.command,
                attemptCount: record.attemptCount,
                queuedAt: record.queuedAt,
                failedAt: now().toISOString(),
                failureCode,
              };
        await atomicCreateJson(join(paths[outcome], `${commandId}.json`), terminal);
        await unlink(leasedPath);
        return terminal;
      });
    },
    async counts() {
      const entries = await Promise.all(
        Object.entries(paths).map(async ([state, path]) => [state, (await jsonFiles(path)).length]),
      );
      return Object.fromEntries(entries);
    },
  };
}

function writeJson(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maximumJsonBytes
  ) {
    throw new AgentBridgeError("INVALID_BODY", "Request body is invalid", 400);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maximumJsonBytes) {
      throw new AgentBridgeError("INVALID_BODY", "Request body is invalid", 400);
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(body)) throw new Error("not an object");
    return body;
  } catch {
    throw new AgentBridgeError("INVALID_BODY", "Request body is invalid", 400);
  }
}

async function waitForClaim(store, workerId, waitMs, leaseDurationMs) {
  const deadline = Date.now() + waitMs;
  let remaining = waitMs;
  while (remaining >= 0) {
    const claim = await store.claim(workerId, leaseDurationMs);
    if (claim !== null) return claim;
    remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(remaining, 200)));
  }
  return null;
}

export async function createLocalAgentBridge({
  vaultPath,
  stateDirectory,
  host = "127.0.0.1",
  port = 0,
  leaseDurationMs = 60_000,
  now = () => new Date(),
}) {
  if (host !== "127.0.0.1") {
    throw new AgentBridgeError("UNSAFE_BIND", "Agent bridge must bind to 127.0.0.1");
  }
  const store = await createVaultCommandStore({ vaultPath, now });
  const requestedStateDirectory = resolve(stateDirectory);
  const canonicalStateDirectory = await canonicalPotentialPath(requestedStateDirectory);
  if (isInside(store.vaultPath, canonicalStateDirectory)) {
    throw new AgentBridgeError("UNSAFE_STATE_PATH", "Bridge state must stay outside the vault");
  }
  await mkdir(requestedStateDirectory, { recursive: true, mode: 0o700 });
  const resolvedStateDirectory = await realpath(requestedStateDirectory);
  if (isInside(store.vaultPath, resolvedStateDirectory)) {
    throw new AgentBridgeError("UNSAFE_STATE_PATH", "Bridge state must stay outside the vault");
  }
  const token = randomBytes(32).toString("hex");

  const server = createServer(async (request, response) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      if (request.headers.origin !== undefined) {
        throw new AgentBridgeError(
          "BROWSER_ORIGIN_FORBIDDEN",
          "Browser-origin requests require explicit pairing",
          403,
        );
      }
      const authorization = request.headers.authorization;
      const candidate = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!safeTokenEquals(candidate, token)) {
        throw new AgentBridgeError("UNAUTHORIZED", "Agent bridge authorization required", 401);
      }

      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/v1/status") {
        if ([...url.searchParams].length !== 0) {
          throw new AgentBridgeError("INVALID_QUERY", "Query is invalid");
        }
        writeJson(response, 200, {
          protocolVersion,
          vaultId: store.vaultId,
          queue: await store.counts(),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/commands/claim") {
        const allowed = new Set(["workerId", "waitMs"]);
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
          throw new AgentBridgeError("INVALID_QUERY", "Query is invalid");
        }
        const workerId = url.searchParams.get("workerId") ?? "";
        const waitText = url.searchParams.get("waitMs") ?? "0";
        if (!/^\d{1,5}$/.test(waitText)) {
          throw new AgentBridgeError("INVALID_QUERY", "Query is invalid");
        }
        const waitMs = Number(waitText);
        if (waitMs > maximumWaitMs) {
          throw new AgentBridgeError("INVALID_QUERY", "Query is invalid");
        }
        const claim = await waitForClaim(store, workerId, waitMs, leaseDurationMs);
        if (claim === null) {
          response.writeHead(204, { "Cache-Control": "no-store" });
          response.end();
          return;
        }
        writeJson(response, 200, claim);
        return;
      }

      const completionMatch = url.pathname.match(
        /^\/v1\/commands\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/complete$/,
      );
      if (request.method === "POST" && completionMatch !== null) {
        if ([...url.searchParams].length !== 0) {
          throw new AgentBridgeError("INVALID_QUERY", "Query is invalid");
        }
        const body = await readJsonBody(request);
        const expectedKeys =
          body.outcome === "failed"
            ? ["workerId", "leaseToken", "outcome", "failureCode"]
            : ["workerId", "leaseToken", "outcome"];
        if (!hasExactKeys(body, expectedKeys)) {
          throw new AgentBridgeError("INVALID_COMPLETION", "Completion request is invalid");
        }
        const terminal = await store.complete({ commandId: completionMatch[1], ...body });
        writeJson(response, 200, {
          protocolVersion,
          commandId: terminal.command.id,
          state: terminal.state,
        });
        return;
      }

      throw new AgentBridgeError("NOT_FOUND", "Route not found", 404);
    } catch (error) {
      if (error instanceof AgentBridgeError) {
        writeJson(response, error.httpStatus, { error: { code: error.code } });
        return;
      }
      writeJson(response, 500, { error: { code: "INTERNAL_ERROR" } });
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string" || address.address !== host) {
    await new Promise((resolvePromise) => server.close(resolvePromise));
    throw new AgentBridgeError("UNSAFE_BIND", "Agent bridge did not bind to loopback");
  }
  const baseUrl = `http://${host}:${address.port}`;
  const statePath = join(resolvedStateDirectory, "bridge.json");
  await atomicReplaceJson(statePath, {
    protocolVersion,
    baseUrl,
    token,
    vaultPath: store.vaultPath,
    pid: process.pid,
    startedAt: now().toISOString(),
  });

  return {
    baseUrl,
    token,
    vaultId: store.vaultId,
    statePath,
    async close() {
      await new Promise((resolvePromise, reject) => {
        server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
      });
      await rm(statePath, { force: true });
    },
  };
}
