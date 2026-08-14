import { createHash, randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionActor } from "../family/family-service.js";

export interface DocumentAgentScope {
  readonly familyId: string;
  readonly profileId: string;
  readonly documentId: string;
}

export interface DocumentAgentCapability {
  readonly actor: SessionActor;
  readonly scope: DocumentAgentScope;
  readonly correlationId: string;
}

export interface DocumentAgentContextProvider {
  getContext(capability: DocumentAgentCapability): Promise<unknown>;
}

export interface DocumentAgentCapabilityStore {
  issue(capability: DocumentAgentCapability): { readonly token: string; revoke(): void };
  resolve(token: string): DocumentAgentCapability | null;
}

interface CapabilityRecord {
  readonly capability: DocumentAgentCapability;
  readonly expiresAt: number;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createDocumentAgentCapabilityStore(options: {
  ttlMs: number;
  now?: () => number;
}): DocumentAgentCapabilityStore {
  if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1_000 || options.ttlMs > 900_000) {
    throw new Error("Document agent capability TTL is invalid");
  }
  const now = options.now ?? Date.now;
  const records = new Map<string, CapabilityRecord>();

  return {
    issue(capability) {
      const token = randomBytes(32).toString("base64url");
      const hash = tokenHash(token);
      records.set(hash, { capability, expiresAt: now() + options.ttlMs });
      return {
        token,
        revoke() {
          records.delete(hash);
        },
      };
    },
    resolve(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const hash = tokenHash(token);
      const record = records.get(hash);
      if (record === undefined) return null;
      if (record.expiresAt <= now()) {
        records.delete(hash);
        return null;
      }
      return record.capability;
    },
  };
}

export function createDocumentAgentMcpServer(
  capability: DocumentAgentCapability,
  provider: DocumentAgentContextProvider,
): McpServer {
  const server = new McpServer(
    { name: "veylta-document-agent", version: "1.0.0" },
    {
      instructions:
        "Получайте текущий контекст только через get_document_context. Не подтверждайте факты и не ставьте диагнозы.",
    },
  );
  server.registerTool(
    "get_document_context",
    {
      title: "Получить контекст документа Veylta",
      description:
        "Возвращает текущую карточку, статус и извлечённые факты только для документа, на который выдана короткоживущая capability.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await provider.getContext(capability)),
        },
      ],
    }),
  );
  return server;
}
