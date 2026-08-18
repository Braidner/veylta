import {
  ASSISTANT_OUTCOME_VERDICTS,
  type AssistantOutcomeRequest,
  MAX_ASSISTANT_OUTCOME_NOTE_LENGTH,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
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
} from "./route-support.js";

interface OutcomeParams extends ConversationParams {
  messageId: string;
  /** A path segment is a string; the schema keeps it a small non-negative integer. */
  blockIndex: string;
}

const outcomeParamsSchema = {
  ...conversationParamsSchema,
  required: [...conversationParamsSchema.required, "messageId", "blockIndex"],
  properties: {
    ...conversationParamsSchema.properties,
    messageId: canonicalUuidSchema,
    blockIndex: { type: "string", pattern: "^(?:0|[1-9][0-9]?)$" },
  },
} as const;

/** `PUT …/messages/:messageId/blocks/:blockIndex/outcome` — the clinician's word on one block. */
export function registerAssistantOutcomeRoutes(
  app: FastifyInstance,
  family: FamilyService,
  service: AssistantService,
  origins: ReadonlySet<string>,
): void {
  app.put<{ Params: OutcomeParams; Body: AssistantOutcomeRequest }>(
    `${base}/conversations/:conversationId/messages/:messageId/blocks/:blockIndex/outcome`,
    {
      schema: {
        params: outcomeParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["verdict", "decidedOn", "note", "recordId"],
          properties: {
            verdict: { type: "string", enum: [...ASSISTANT_OUTCOME_VERDICTS] },
            decidedOn: {
              anyOf: [
                { type: "null" },
                { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
              ],
            },
            note: {
              anyOf: [
                { type: "null" },
                { type: "string", minLength: 1, maxLength: MAX_ASSISTANT_OUTCOME_NOTE_LENGTH },
              ],
            },
            recordId: { anyOf: [{ type: "null" }, canonicalUuidSchema] },
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
        const { assistantId, conversationId, messageId, blockIndex, ...scope } = request.params;
        const result = await service.recordOutcome(
          actor,
          scope,
          assistantId,
          conversationId,
          messageId,
          Number(blockIndex),
          request.body,
          request.id,
        );
        reply.code(result.created ? 201 : 200).send(result.response);
      } catch (error) {
        if (!sendAssistantError(error, request, reply)) throw error;
      }
    },
  );
}
