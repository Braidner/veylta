import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  DOCUMENT_AGENT_CONTRACT_VERSION,
  MAX_SYNTHETIC_PDF_BYTES,
} from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { DocumentAgentRuntime } from "../src/agent/codex-document-agent-runtime.js";
import { createDocumentAgentCapabilityStore } from "../src/agent/document-agent-mcp.js";
import { createDocumentAgentService } from "../src/agent/document-agent-service.js";
import { registerDocumentAgentRoutes } from "../src/agent/routes.js";
import { buildApp } from "../src/app.js";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { createDocumentService } from "../src/documents/document-service.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";

const webOrigin = "http://127.0.0.1:4300";
const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const value = response.headers["set-cookie"];
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") throw new Error("Expected session cookie");
  return header.split(";", 1)[0] ?? "";
}

function multipartFile(bytes: Buffer) {
  const boundary = `veylta-agent-${randomUUID()}`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-agent-report.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function registerOwner(app: FastifyInstance, suffix: string): Promise<Identity> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/demo/registrations",
    headers: { origin: webOrigin },
    payload: {
      displayName: `Synthetic Owner ${suffix}`,
      familyName: `Synthetic Family ${suffix}`,
      profileName: `Synthetic Profile ${suffix}`,
    },
  });
  assert.equal(response.statusCode, 201);
  return { body: response.json(), cookie: cookieFrom(response) };
}

async function upload(app: FastifyInstance, owner: Identity): Promise<string> {
  const multipart = multipartFile(await readFile(fixtureUrl));
  const response = await app.inject({
    method: "POST",
    url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "content-type": multipart.contentType,
      "idempotency-key": "agent-upload-key".padEnd(16, "_"),
    },
    payload: multipart.body,
  });
  assert.equal(response.statusCode, 202);
  return response.json().document.id as string;
}

test("document owner holds a replay-safe Russian Codex conversation", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-agent-integration-"));
  const database: Database = createDatabase(join(root, "test.sqlite"));
  await migrateUp(database);
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  const familyService = createFamilyService(database, {
    cookieName: "veylta_session",
    secureCookie: false,
    sessionTtlSeconds: 3_600,
  });
  const documentService = createDocumentService(
    database,
    createLocalObjectStorage(join(root, "storage")),
    { maxDocumentBytes: MAX_SYNTHETIC_PDF_BYTES },
  );
  const runtimeCalls: Array<{ threadId: string | null; message: string }> = [];
  const runtime: DocumentAgentRuntime = {
    async respond(input) {
      runtimeCalls.push({ threadId: input.threadId, message: input.message });
      return {
        threadId: "10000000-0000-4000-8000-000000000001",
        text:
          input.threadId === null
            ? "В исходнике не указана лаборатория. Напишите её название."
            : "Принято. Я учту название лаборатории в рамках этого диалога.",
        modelId: "gpt-5.4-mini",
        runtimeVersion: "codex-cli 0.147.0",
      };
    },
  };
  const capabilities = createDocumentAgentCapabilityStore({ ttlMs: 60_000 });
  const agentService = createDocumentAgentService(database, documentService, runtime, capabilities);
  registerFamilyRoutes(app, familyService, {
    allowedMutationOrigins: [webOrigin],
    demoRegistrationEnabled: true,
  });
  registerDocumentRoutes(app, familyService, documentService, {
    allowedMutationOrigins: [webOrigin],
    maxDocumentBytes: MAX_SYNTHETIC_PDF_BYTES,
  });
  registerDocumentAgentRoutes(app, familyService, agentService, {
    allowedMutationOrigins: [webOrigin],
  });

  try {
    const owner = await registerOwner(app, "Agent");
    const stranger = await registerOwner(app, "Stranger");
    const documentId = await upload(app, owner);
    const url = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}/agent`;

    const empty = await app.inject({ method: "GET", url, headers: { cookie: owner.cookie } });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), {
      contractVersion: DOCUMENT_AGENT_CONTRACT_VERSION,
      documentId,
      conversationId: null,
      messages: [],
    });

    const command = {
      method: "POST" as const,
      url: `${url}/messages`,
      headers: {
        cookie: owner.cookie,
        origin: webOrigin,
        "idempotency-key": "agent-message-one".padEnd(16, "_"),
      },
      payload: { message: "Проверь лабораторию и дату биоматериала." },
    };
    const created = await app.inject(command);
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().messages.length, 2);
    assert.equal(created.json().messages[1].provenance.provider, "codex");

    const replay = await app.inject(command);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), created.json());
    assert.equal(runtimeCalls.length, 1);

    const second = await app.inject({
      ...command,
      headers: {
        ...command.headers,
        "idempotency-key": "agent-message-two".padEnd(16, "_"),
      },
      payload: { message: "Лаборатория — Синтетическая лаборатория." },
    });
    assert.equal(second.statusCode, 201);
    assert.equal(second.json().messages.length, 4);
    assert.equal(runtimeCalls[1]?.threadId, "10000000-0000-4000-8000-000000000001");

    const conflict = await app.inject({
      ...command,
      payload: { message: "Другой текст с тем же ключом." },
    });
    assert.equal(conflict.statusCode, 409);

    const missingOrigin = await app.inject({
      ...command,
      headers: {
        cookie: owner.cookie,
        "idempotency-key": "agent-message-three".padEnd(16, "_"),
      },
    });
    assert.equal(missingOrigin.statusCode, 403);

    const foreign = await app.inject({ method: "GET", url, headers: { cookie: stranger.cookie } });
    assert.equal(foreign.statusCode, 404);

    const audits = await database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE family_id = $1 AND action LIKE 'document.agent.%'
        ORDER BY created_at`,
      [owner.body.family.id],
    );
    assert.ok(audits.rows.some((row) => row.action === "document.agent.message.created"));
    assert.ok(audits.rows.every((row) => !row.metadata.includes("лаборатор")));
    assert.equal(await migrateDown(database), "0021_codex_preferences");
    await assert.rejects(() => migrateDown(database), /CHECK constraint failed/);
  } finally {
    await app.close();
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
