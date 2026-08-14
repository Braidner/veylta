import { createHash, randomUUID } from "node:crypto";
import {
  DOCUMENT_AGENT_CONTRACT_VERSION,
  type DocumentAgentConversationResponse,
  type DocumentAgentMessage,
} from "@veylta/contracts";
import type { Database, DatabaseClient } from "../database/pool.js";
import type { DocumentService } from "../documents/document-service.js";
import {
  DomainConflictError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import type { DocumentAgentRuntime } from "./codex-document-agent-runtime.js";
import type {
  DocumentAgentCapability,
  DocumentAgentCapabilityStore,
  DocumentAgentContextProvider,
  DocumentAgentScope,
} from "./document-agent-mcp.js";

export class DocumentAgentIdempotencyConflictError extends DomainConflictError {}
export class DocumentAgentUnavailableError extends Error {}

export interface DocumentAgentService extends DocumentAgentContextProvider {
  getConversation(
    actor: SessionActor,
    scope: DocumentAgentScope,
    correlationId: string,
  ): Promise<DocumentAgentConversationResponse>;
  sendMessage(
    actor: SessionActor,
    scope: DocumentAgentScope,
    message: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ readonly response: DocumentAgentConversationResponse; readonly replayed: boolean }>;
}

interface ConversationRow {
  id: string;
  document_version_id: string;
  codex_thread_id: string | null;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  text: string;
  model_id: string | null;
  runtime_version: string | null;
  created_at: string;
}

interface RequestRow {
  request_hash: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requiredTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Document agent timestamp is invalid");
  }
  return value;
}

function messageFromRow(row: MessageRow): DocumentAgentMessage {
  if (row.role === "user") {
    if (row.model_id !== null || row.runtime_version !== null) {
      throw new Error("Document agent message provenance is invalid");
    }
    return {
      id: row.id,
      role: row.role,
      text: row.text,
      createdAt: requiredTimestamp(row.created_at),
      provenance: null,
    };
  }
  if (row.model_id === null || row.runtime_version === null) {
    throw new Error("Document agent message provenance is invalid");
  }
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    createdAt: requiredTimestamp(row.created_at),
    provenance: {
      provider: "codex",
      modelId: row.model_id,
      runtimeVersion: row.runtime_version,
    },
  };
}

async function requireDocumentWriteAccess(
  client: DatabaseClient,
  actor: SessionActor,
  scope: DocumentAgentScope,
): Promise<string> {
  const row = (
    await client.query<{ document_version_id: string }>(
      `SELECT version.id AS document_version_id
         FROM documents AS document
         JOIN patient_profiles AS profile
           ON profile.family_id = document.family_id
          AND profile.id = document.patient_profile_id
          AND profile.archived_at IS NULL
         JOIN family_memberships AS membership
           ON membership.family_id = document.family_id
          AND membership.user_id = $4
          AND membership.status = 'active'
          AND (
            membership.role = 'owner'
            OR (
              membership.role = 'adult_member'
              AND profile.linked_user_id = membership.user_id
            )
          )
         JOIN document_versions AS version
           ON version.family_id = document.family_id
          AND version.document_id = document.id
          AND version.version_number = 1
        WHERE document.family_id = $1
          AND document.patient_profile_id = $2
          AND document.id = $3
          AND document.deleted_at IS NULL`,
      [scope.familyId, scope.profileId, scope.documentId, actor.userId],
    )
  ).rows[0];
  if (row === undefined) throw new ResourceNotFoundError();
  return row.document_version_id;
}

async function audit(
  client: DatabaseClient,
  input: {
    familyId: string;
    actorUserId: string;
    action: string;
    documentId: string;
    correlationId: string;
    createdAt: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, 'DocumentAgentConversation', $5, 'success', $6, $7, $8)`,
    [
      randomUUID(),
      input.familyId,
      input.actorUserId,
      input.action,
      input.documentId,
      input.correlationId,
      { contractVersion: DOCUMENT_AGENT_CONTRACT_VERSION },
      input.createdAt,
    ],
  );
}

async function conversationResponse(
  client: DatabaseClient,
  scope: DocumentAgentScope,
): Promise<DocumentAgentConversationResponse> {
  const conversation = (
    await client.query<{ id: string }>(
      `SELECT id
         FROM document_agent_conversations
        WHERE family_id = $1 AND document_id = $2`,
      [scope.familyId, scope.documentId],
    )
  ).rows[0];
  if (conversation === undefined) {
    return {
      contractVersion: DOCUMENT_AGENT_CONTRACT_VERSION,
      documentId: scope.documentId,
      conversationId: null,
      messages: [],
    };
  }
  const rows = await client.query<MessageRow>(
    `SELECT id, role, text, model_id, runtime_version, created_at
      FROM document_agent_messages
      WHERE family_id = $1 AND conversation_id = $2
      ORDER BY sequence ASC
      LIMIT 100`,
    [scope.familyId, conversation.id],
  );
  return {
    contractVersion: DOCUMENT_AGENT_CONTRACT_VERSION,
    documentId: scope.documentId,
    conversationId: conversation.id,
    messages: rows.rows.map(messageFromRow),
  };
}

export function createDocumentAgentService(
  database: Database,
  documents: DocumentService,
  runtime: DocumentAgentRuntime,
  capabilities: DocumentAgentCapabilityStore,
): DocumentAgentService {
  const locks = new Map<string, Promise<unknown>>();

  async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  }

  async function authorize(actor: SessionActor, scope: DocumentAgentScope): Promise<string> {
    return database.transaction((client) => requireDocumentWriteAccess(client, actor, scope));
  }

  return {
    async getConversation(actor, scope, correlationId) {
      return database.transaction(async (client) => {
        await requireDocumentWriteAccess(client, actor, scope);
        const response = await conversationResponse(client, scope);
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.agent.opened",
          documentId: scope.documentId,
          correlationId,
          createdAt: new Date(),
        });
        return response;
      });
    },

    async sendMessage(actor, scope, rawMessage, idempotencyKey, correlationId) {
      const message = rawMessage.trim();
      if (message.length < 1 || message.length > 2_000) {
        throw new DomainConflictError();
      }
      return serialized(`${scope.familyId}:${scope.documentId}`, async () => {
        const keyHash = sha256(idempotencyKey);
        const requestHash = sha256(JSON.stringify({ documentId: scope.documentId, message }));
        const replay = await database.transaction(async (client) => {
          await requireDocumentWriteAccess(client, actor, scope);
          const request = (
            await client.query<RequestRow>(
              `SELECT request_hash
                 FROM document_agent_message_requests
                WHERE family_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
              [scope.familyId, actor.userId, keyHash],
            )
          ).rows[0];
          if (request === undefined) return null;
          if (request.request_hash !== requestHash) {
            throw new DocumentAgentIdempotencyConflictError();
          }
          return conversationResponse(client, scope);
        });
        if (replay !== null) return { response: replay, replayed: true };

        const documentVersionId = await authorize(actor, scope);
        const now = new Date();
        const conversation = await database.transaction(async (client) => {
          const existing = (
            await client.query<ConversationRow>(
              `SELECT id, document_version_id, codex_thread_id
                 FROM document_agent_conversations
                WHERE family_id = $1 AND document_id = $2`,
              [scope.familyId, scope.documentId],
            )
          ).rows[0];
          if (existing !== undefined) return existing;
          const id = randomUUID();
          await client.query(
            `INSERT INTO document_agent_conversations
               (id, family_id, patient_profile_id, document_id, document_version_id,
                created_by_user_id, codex_thread_id, model_id, runtime_version,
                created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, $7, $7)`,
            [
              id,
              scope.familyId,
              scope.profileId,
              scope.documentId,
              documentVersionId,
              actor.userId,
              now,
            ],
          );
          return { id, document_version_id: documentVersionId, codex_thread_id: null };
        });
        if (conversation.document_version_id !== documentVersionId) {
          throw new DocumentAgentUnavailableError();
        }

        const capability = capabilities.issue({ actor, scope, correlationId });
        let generated: Awaited<ReturnType<DocumentAgentRuntime["respond"]>>;
        try {
          generated = await runtime.respond({
            threadId: conversation.codex_thread_id,
            message,
            capabilityToken: capability.token,
          });
        } catch {
          throw new DocumentAgentUnavailableError();
        } finally {
          capability.revoke();
        }

        const response = await database.transaction(async (client) => {
          await requireDocumentWriteAccess(client, actor, scope);
          const latest = (
            await client.query<ConversationRow>(
              `SELECT id, document_version_id, codex_thread_id
                 FROM document_agent_conversations
                WHERE family_id = $1 AND id = $2`,
              [scope.familyId, conversation.id],
            )
          ).rows[0];
          if (
            latest === undefined ||
            latest.document_version_id !== documentVersionId ||
            (latest.codex_thread_id !== null && latest.codex_thread_id !== generated.threadId)
          ) {
            throw new DocumentAgentUnavailableError();
          }
          const existingRequest = (
            await client.query<RequestRow>(
              `SELECT request_hash
                 FROM document_agent_message_requests
                WHERE family_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
              [scope.familyId, actor.userId, keyHash],
            )
          ).rows[0];
          if (existingRequest !== undefined) {
            if (existingRequest.request_hash !== requestHash) {
              throw new DocumentAgentIdempotencyConflictError();
            }
            return conversationResponse(client, scope);
          }
          const count = await client.query<{ value: number }>(
            `SELECT count(*) AS value
               FROM document_agent_messages
              WHERE family_id = $1 AND conversation_id = $2`,
            [scope.familyId, conversation.id],
          );
          if ((count.rows[0]?.value ?? 0) > 98) throw new DomainConflictError();

          const userMessageId = randomUUID();
          const assistantMessageId = randomUUID();
          const createdAt = new Date();
          await client.query(
            `INSERT INTO document_agent_messages
               (id, family_id, conversation_id, sequence, role, actor_user_id, text,
                model_id, runtime_version, created_at)
             VALUES ($1, $2, $3, $4, 'user', $5, $6, NULL, NULL, $7),
                    ($8, $2, $3, $9, 'assistant', NULL, $10, $11, $12, $7)`,
            [
              userMessageId,
              scope.familyId,
              conversation.id,
              (count.rows[0]?.value ?? 0) + 1,
              actor.userId,
              message,
              createdAt,
              assistantMessageId,
              (count.rows[0]?.value ?? 0) + 2,
              generated.text,
              generated.modelId,
              generated.runtimeVersion,
            ],
          );
          if (latest.codex_thread_id === null) {
            await client.query(
              `UPDATE document_agent_conversations
                  SET codex_thread_id = $1, model_id = $2, runtime_version = $3, updated_at = $4
                WHERE family_id = $5 AND id = $6 AND codex_thread_id IS NULL`,
              [
                generated.threadId,
                generated.modelId,
                generated.runtimeVersion,
                createdAt,
                scope.familyId,
                conversation.id,
              ],
            );
          } else {
            await client.query(
              `UPDATE document_agent_conversations
                  SET updated_at = $1
                WHERE family_id = $2 AND id = $3`,
              [createdAt, scope.familyId, conversation.id],
            );
          }
          await client.query(
            `INSERT INTO document_agent_message_requests
               (id, family_id, actor_user_id, conversation_id, user_message_id,
                assistant_message_id, idempotency_key_hash, request_hash, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              randomUUID(),
              scope.familyId,
              actor.userId,
              conversation.id,
              userMessageId,
              assistantMessageId,
              keyHash,
              requestHash,
              createdAt,
            ],
          );
          await audit(client, {
            familyId: scope.familyId,
            actorUserId: actor.userId,
            action: "document.agent.message.created",
            documentId: scope.documentId,
            correlationId,
            createdAt,
          });
          return conversationResponse(client, scope);
        });
        return { response, replayed: false };
      });
    },

    async getContext(capability: DocumentAgentCapability) {
      await authorize(capability.actor, capability.scope);
      const [document, processing, facts] = await Promise.all([
        documents.getDocument(
          capability.actor,
          capability.scope,
          `${capability.correlationId}:document`,
        ),
        documents.getProcessing(
          capability.actor,
          capability.scope,
          `${capability.correlationId}:processing`,
        ),
        documents.getFacts(capability.actor, capability.scope, `${capability.correlationId}:facts`),
      ]);
      return {
        contractVersion: DOCUMENT_AGENT_CONTRACT_VERSION,
        document: {
          id: document.id,
          originalFilename: document.originalFilename,
          uploadedAt: document.uploadedAt,
          intelligence: document.intelligence,
        },
        processing: processing.processing,
        facts: facts.items.map((fact) => ({
          id: fact.id,
          sourceName: fact.sourceName,
          sourceValue: fact.sourceValue,
          sourceUnit: fact.sourceUnit,
          canonicalCode: fact.proposedCanonicalCode,
          canonicalDisplayName: fact.canonicalDisplayName,
          sampledAt: fact.proposedSampledAt,
          resultedAt: fact.proposedResultedAt,
          specimenType: fact.proposedSpecimenType,
          laboratory: fact.proposedLaboratory,
          confidence: fact.confidence,
          validationIssues: fact.validationIssues,
          reviewStatus: fact.reviewStatus,
          source: fact.source,
        })),
      };
    },
  };
}
