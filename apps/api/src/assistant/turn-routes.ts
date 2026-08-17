import {
  type AssistantConsiliumRequest,
  type AssistantMessageRequest,
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_CONSILIUM_SPECIALISTS,
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
import {
  base,
  type ConversationParams,
  conversationParamsSchema,
  sendAssistantError,
  specialtySchema,
} from "./route-support.js";

/** The turns: a message to the therapist or one persona, and convening the консилиум. */
export function registerAssistantTurnRoutes(
  app: FastifyInstance,
  family: FamilyService,
  service: AssistantService,
  origins: ReadonlySet<string>,
): void {
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
            addressee: specialtySchema,
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

  app.post<{ Params: ConversationParams; Body: AssistantConsiliumRequest }>(
    `${base}/conversations/:conversationId/consilium`,
    {
      schema: {
        params: conversationParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["question"],
          properties: {
            question: {
              anyOf: [
                { type: "null" },
                { type: "string", minLength: 1, maxLength: MAX_ASSISTANT_MESSAGE_LENGTH },
              ],
            },
            specialties: {
              type: "array",
              maxItems: MAX_CONSILIUM_SPECIALISTS,
              uniqueItems: true,
              items: specialtySchema,
            },
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
        const result = await service.convene(
          actor,
          scope,
          assistantId,
          conversationId,
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
}
