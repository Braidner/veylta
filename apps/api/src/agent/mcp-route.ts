import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createDocumentAgentMcpServer,
  type DocumentAgentCapability,
  type DocumentAgentCapabilityStore,
  type DocumentAgentContextProvider,
} from "./document-agent-mcp.js";

interface Session {
  readonly capability: DocumentAgentCapability;
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
}

function bearerToken(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length);
}

function deny(reply: FastifyReply, statusCode: 401 | 403 | 404): void {
  reply.code(statusCode).send({ error: statusCode === 401 ? "unauthorized" : "not_found" });
}

export function registerDocumentAgentMcpRoute(
  app: FastifyInstance,
  capabilities: DocumentAgentCapabilityStore,
  provider: DocumentAgentContextProvider,
): void {
  const sessions = new Map<string, Session>();

  async function closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    sessions.delete(sessionId);
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  }

  app.addHook("onClose", async () => {
    await Promise.all([...sessions.keys()].map(closeSession));
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/document-agent",
    handler: async (request, reply) => {
      if (request.headers.origin !== undefined) {
        deny(reply, 403);
        return;
      }
      const token = bearerToken(request);
      const capability = token === null ? null : capabilities.resolve(token);
      if (capability === null) {
        deny(reply, 401);
        return;
      }

      const header = request.headers["mcp-session-id"];
      const sessionId = typeof header === "string" ? header : undefined;
      let session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (session !== undefined && session.capability !== capability) {
        deny(reply, 404);
        return;
      }
      if (session === undefined) {
        if (request.method !== "POST" || sessionId !== undefined) {
          deny(reply, 404);
          return;
        }
        const server = createDocumentAgentMcpServer(capability, provider);
        let created: Session | undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            if (created !== undefined) sessions.set(id, created);
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
          },
        });
        created = { capability, server, transport };
        session = created;
        // SDK 1.30's concrete transport keeps optional callbacks as `| undefined`,
        // while its base Transport declaration uses exact optional properties.
        await server.connect(transport as unknown as Transport);
      }

      reply.hijack();
      try {
        await session.transport.handleRequest(request.raw, reply.raw, request.body);
      } catch {
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.setHeader("content-type", "application/json");
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            }),
          );
        }
      } finally {
        if (request.method === "DELETE" && sessionId !== undefined) {
          await closeSession(sessionId);
        }
      }
    },
  });
}
