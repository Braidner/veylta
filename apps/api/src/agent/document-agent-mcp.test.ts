import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { buildApp } from "../app.js";
import type { SessionActor } from "../family/family-service.js";
import {
  createDocumentAgentCapabilityStore,
  createDocumentAgentMcpServer,
} from "./document-agent-mcp.js";
import { registerDocumentAgentMcpRoute } from "./mcp-route.js";

const actor: SessionActor = {
  userId: "00000000-0000-4000-8000-000000000001",
  username: "synthetic-owner",
  displayName: "Синтетический владелец",
  accountRole: "admin",
  tokenHash: "a".repeat(64),
};

test("document agent capability is short-lived and resolves one exact scope", () => {
  const store = createDocumentAgentCapabilityStore({ ttlMs: 60_000 });
  const issued = store.issue({
    actor,
    scope: {
      familyId: "00000000-0000-4000-8000-000000000002",
      profileId: "00000000-0000-4000-8000-000000000003",
      documentId: "00000000-0000-4000-8000-000000000004",
    },
    correlationId: "agent-test",
  });

  assert.equal(store.resolve(issued.token)?.scope.documentId.endsWith("4"), true);
  assert.equal(store.resolve("wrong-token"), null);
  issued.revoke();
  assert.equal(store.resolve(issued.token), null);
});

test("MCP exposes only the current document context as a read-only tool", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createDocumentAgentMcpServer(
    {
      actor,
      scope: {
        familyId: "00000000-0000-4000-8000-000000000002",
        profileId: "00000000-0000-4000-8000-000000000003",
        documentId: "00000000-0000-4000-8000-000000000004",
      },
      correlationId: "agent-test",
    },
    {
      async getContext() {
        return {
          document: { title: "Синтетический лабораторный отчёт" },
          processing: { state: "awaiting_review" },
          facts: [
            {
              sourceName: "Билирубин общий (TB)",
              sourceValue: "9,9",
              sourceUnit: "мкмоль/л",
              laboratory: null,
              sampledAt: null,
              canonicalCode: "bilirubin.total",
            },
          ],
        };
      },
    },
  );
  const client = new Client({ name: "veylta-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      ["get_document_context"],
    );
    assert.equal(tools.tools[0]?.annotations?.readOnlyHint, true);
    const result = await client.callTool({ name: "get_document_context", arguments: {} });
    if (!Array.isArray(result.content)) throw new Error("Expected MCP content");
    const text = result.content[0];
    assert.equal(text?.type, "text");
    if (text?.type !== "text") throw new Error("Expected text result");
    assert.match(text.text, /bilirubin\.total/);
    assert.match(text.text, /Синтетический лабораторный отчёт/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("loopback MCP transport requires a capability and rejects browser origins", async () => {
  const store = createDocumentAgentCapabilityStore({ ttlMs: 60_000 });
  const issued = store.issue({
    actor,
    scope: {
      familyId: "00000000-0000-4000-8000-000000000002",
      profileId: "00000000-0000-4000-8000-000000000003",
      documentId: "00000000-0000-4000-8000-000000000004",
    },
    correlationId: "agent-http-test",
  });
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  registerDocumentAgentMcpRoute(app, store, {
    async getContext() {
      return { document: { title: "Синтетический документ" } };
    },
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const url = new URL("/mcp/document-agent", origin);
  const client = new Client({ name: "veylta-http-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${issued.token}` } },
  });
  try {
    await client.connect(transport as unknown as Transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      ["get_document_context"],
    );

    const browserAttempt = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${issued.token}`,
        "content-type": "application/json",
        origin: "http://127.0.0.1:4300",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: {} },
      }),
    });
    assert.equal(browserAttempt.status, 403);
  } finally {
    await client.close();
    issued.revoke();
    await app.close();
  }
});
