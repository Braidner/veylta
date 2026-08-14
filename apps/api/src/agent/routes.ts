import {
  DOCUMENT_AGENT_MESSAGE_COMMAND_SCHEMA,
  type DocumentAgentMessageCommand,
} from "@veylta/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  errorEnvelope,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import {
  type DocumentAgentService,
  DocumentAgentUnavailableError,
} from "./document-agent-service.js";

interface DocumentAgentParams {
  familyId: string;
  profileId: string;
  documentId: string;
}

export interface DocumentAgentRouteOptions {
  readonly allowedMutationOrigins: readonly string[];
}

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "documentId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    documentId: canonicalUuidSchema,
  },
} as const;

class InvalidDocumentAgentIdempotencyKeyError extends Error {}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || !/^[\x21-\x7e]{16,200}$/.test(value)) {
    throw new InvalidDocumentAgentIdempotencyKeyError();
  }
  return value;
}

function sendAgentError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof InvalidDocumentAgentIdempotencyKeyError) {
    reply
      .code(400)
      .send(errorEnvelope("VALIDATION_ERROR", "The request could not be accepted.", request.id));
    return true;
  }
  if (error instanceof DocumentAgentUnavailableError) {
    reply
      .code(503)
      .send(
        errorEnvelope(
          "DOCUMENT_AGENT_UNAVAILABLE",
          "The document agent is temporarily unavailable.",
          request.id,
        ),
      );
    return true;
  }
  return sendDomainError(error, request, reply);
}

export function registerDocumentAgentRoutes(
  app: FastifyInstance,
  familyService: FamilyService,
  service: DocumentAgentService,
  options: DocumentAgentRouteOptions,
): void {
  const allowedOrigins = new Set(options.allowedMutationOrigins);
  app.register(async (scope) => {
    scope.get<{ Params: DocumentAgentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/agent",
      { schema: { params: paramsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(await service.getConversation(actor, request.params, request.id));
        } catch (error) {
          if (!sendAgentError(error, request, reply)) throw error;
        }
      },
    );

    scope.post<{ Params: DocumentAgentParams; Body: DocumentAgentMessageCommand }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/agent/messages",
      {
        schema: {
          params: paramsSchema,
          body: DOCUMENT_AGENT_MESSAGE_COMMAND_SCHEMA,
        },
      },
      async (request, reply) => {
        privateResponse(reply);
        try {
          if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
          const actor = await requireActor(familyService, request, reply);
          if (actor === null) return;
          const result = await service.sendMessage(
            actor,
            request.params,
            request.body.message,
            idempotencyKey(request),
            request.id,
          );
          reply.code(result.replayed ? 200 : 201).send(result.response);
        } catch (error) {
          if (!sendAgentError(error, request, reply)) throw error;
        }
      },
    );
  });
}
