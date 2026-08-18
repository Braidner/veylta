import {
  ASSISTANT_CONVERSATION_PURPOSES,
  ASSISTANT_EGRESS_ACKNOWLEDGEMENT,
  type AssistantAcknowledgementRequest,
  type AssistantConversationCreateRequest,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  idempotencyKey,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
} from "../http/route-helpers.js";
import type { AssistantService } from "./assistant-service.js";
import { registerAssistantOutcomeRoutes } from "./outcome-routes.js";
import {
  type AssistantParams,
  base,
  type ConversationParams,
  conversationParamsSchema,
  paramsSchema,
  querySchema,
  sendAssistantError,
} from "./route-support.js";
import { registerAssistantTurnRoutes } from "./turn-routes.js";

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
          properties: {
            title: { type: "string", minLength: 1, maxLength: 80 },
            purpose: { type: "string", enum: [...ASSISTANT_CONVERSATION_PURPOSES] },
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
        const { assistantId, ...scope } = request.params;
        const result = await service.createConversation(
          actor,
          scope,
          assistantId,
          request.body,
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

  registerAssistantTurnRoutes(app, family, service, origins);
  registerAssistantOutcomeRoutes(app, family, service, origins);
}
