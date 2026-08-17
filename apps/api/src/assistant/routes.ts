import {
  ASSISTANT_EGRESS_ACKNOWLEDGEMENT,
  ASSISTANT_IDS,
  type AssistantAcknowledgementRequest,
  type AssistantConversationCreateRequest,
  type AssistantId,
  type AssistantMessageRequest,
  MAX_ASSISTANT_MESSAGE_LENGTH,
} from "@veylta/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  errorEnvelope,
  idempotencyKey,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import {
  AssistantAcknowledgementRequiredError,
  type AssistantService,
} from "./assistant-service.js";

interface AssistantParams {
  familyId: string;
  profileId: string;
  assistantId: AssistantId;
}

interface ConversationParams extends AssistantParams {
  conversationId: string;
}

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "assistantId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    assistantId: { type: "string", enum: ASSISTANT_IDS },
  },
} as const;

const conversationParamsSchema = {
  ...paramsSchema,
  required: [...paramsSchema.required, "conversationId"],
  properties: { ...paramsSchema.properties, conversationId: canonicalUuidSchema },
} as const;

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: { conversationId: canonicalUuidSchema },
} as const;

const base = "/v1/families/:familyId/profiles/:profileId/assistants/:assistantId";

function sendAssistantError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof AssistantAcknowledgementRequiredError) {
    reply
      .code(409)
      .send(
        errorEnvelope(
          "ACKNOWLEDGEMENT_REQUIRED",
          "The egress disclosure must be acknowledged before a message is sent.",
          request.id,
        ),
      );
    return true;
  }
  return sendDomainError(error, request, reply);
}

export function registerAssistantRoutes(
  app: FastifyInstance,
  family: FamilyService,
  service: AssistantService,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);

  app.get<{ Params: AssistantParams; Querystring: { conversationId?: string } }>(
    base,
    { schema: { params: paramsSchema, querystring: querySchema } },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        const { assistantId, ...scope } = request.params;
        reply.send(
          await service.getWorkspace(
            actor,
            scope,
            assistantId,
            request.query.conversationId ?? null,
            request.id,
          ),
        );
      } catch (error) {
        if (!sendAssistantError(error, request, reply)) throw error;
      }
    },
  );

  app.post<{ Params: AssistantParams; Body: AssistantConversationCreateRequest }>(
    `${base}/conversations`,
    {
      schema: {
        params: paramsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title"],
          properties: { title: { type: "string", minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(origins, request, reply)) return;
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        const { assistantId, ...scope } = request.params;
        const result = await service.createConversation(
          actor,
          scope,
          assistantId,
          request.body.title,
          idempotencyKey(request),
          request.id,
        );
        reply.code(result.replayed ? 200 : 201).send(result.response);
      } catch (error) {
        if (!sendAssistantError(error, request, reply)) throw error;
      }
    },
  );

  app.put<{ Params: ConversationParams; Body: AssistantAcknowledgementRequest }>(
    `${base}/conversations/:conversationId/acknowledgement`,
    {
      schema: {
        params: conversationParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["acknowledgement"],
          properties: {
            acknowledgement: { type: "string", const: ASSISTANT_EGRESS_ACKNOWLEDGEMENT },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(origins, request, reply)) return;
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        const { assistantId, conversationId, ...scope } = request.params;
        reply.send(
          await service.acknowledge(
            actor,
            scope,
            assistantId,
            conversationId,
            request.body.acknowledgement,
            request.id,
          ),
        );
      } catch (error) {
        if (!sendAssistantError(error, request, reply)) throw error;
      }
    },
  );

  app.post<{ Params: ConversationParams; Body: AssistantMessageRequest }>(
    `${base}/conversations/:conversationId/messages`,
    {
      schema: {
        params: conversationParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: MAX_ASSISTANT_MESSAGE_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(origins, request, reply)) return;
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        const { assistantId, conversationId, ...scope } = request.params;
        const result = await service.sendMessage(
          actor,
          scope,
          assistantId,
          conversationId,
          request.body.message,
          idempotencyKey(request),
          request.id,
        );
        reply.code(result.replayed ? 200 : 201).send(result.response);
      } catch (error) {
        if (!sendAssistantError(error, request, reply)) throw error;
      }
    },
  );
}
