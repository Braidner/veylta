import { ASSISTANT_IDS, ASSISTANT_SPECIALTIES, type AssistantId } from "@veylta/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { canonicalUuidSchema, errorEnvelope, sendDomainError } from "../http/route-helpers.js";
import {
  AssistantAcknowledgementRequiredError,
  AssistantNobodyToConveneError,
} from "./assistant-service.js";

export interface AssistantParams {
  familyId: string;
  profileId: string;
  assistantId: AssistantId;
}

export interface ConversationParams extends AssistantParams {
  conversationId: string;
}

export const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "assistantId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    assistantId: { type: "string", enum: ASSISTANT_IDS },
  },
} as const;

export const conversationParamsSchema = {
  ...paramsSchema,
  required: [...paramsSchema.required, "conversationId"],
  properties: { ...paramsSchema.properties, conversationId: canonicalUuidSchema },
} as const;

export const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: { conversationId: canonicalUuidSchema },
} as const;

export const base = "/v1/families/:familyId/profiles/:profileId/assistants/:assistantId";

export function sendAssistantError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
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
  if (error instanceof AssistantNobodyToConveneError) {
    reply
      .code(409)
      .send(
        errorEnvelope(
          "NOBODY_TO_CONVENE",
          "The evidence names no specialist and none was added.",
          request.id,
        ),
      );
    return true;
  }
  return sendDomainError(error, request, reply);
}

export const specialtySchema = { type: "string", enum: ASSISTANT_SPECIALTIES } as const;
