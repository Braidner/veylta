import type { CarePlanItemCreateRequest, CarePlanItemStateRequest } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import type { CarePlanService } from "./care-plan-service.js";

interface ProfileParams {
  familyId: string;
  profileId: string;
}

interface ItemParams extends ProfileParams {
  itemId: string;
}

const profileParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId"],
  properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
} as const;

const itemParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "itemId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    itemId: canonicalUuidSchema,
  },
} as const;

const localDateSchema = {
  anyOf: [{ type: "null" }, { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }],
} as const;

export function registerCarePlanRoutes(
  app: FastifyInstance,
  family: FamilyService,
  service: CarePlanService,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);

  app.get<{ Params: ProfileParams }>(
    "/v1/families/:familyId/profiles/:profileId/care-plan",
    { schema: { params: profileParamsSchema } },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        reply.send(await service.get(actor, request.params, request.id));
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.put<{ Params: ItemParams; Body: CarePlanItemCreateRequest }>(
    "/v1/families/:familyId/profiles/:profileId/care-plan/items/:itemId",
    {
      schema: {
        params: itemParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["category", "title", "note", "scheduledFor"],
          properties: {
            category: {
              type: "string",
              enum: ["laboratory", "clinician", "nutrition", "activity", "reminder"],
            },
            title: { type: "string", minLength: 1, maxLength: 120 },
            note: {
              anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 500 }],
            },
            scheduledFor: localDateSchema,
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
        const result = await service.createItem(
          actor,
          request.params,
          request.params.itemId,
          request.body,
          request.id,
        );
        reply.code(result.created ? 201 : 200).send(result.response);
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.put<{ Params: ItemParams; Body: CarePlanItemStateRequest }>(
    "/v1/families/:familyId/profiles/:profileId/care-plan/items/:itemId/state",
    {
      schema: {
        params: itemParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["revision", "state", "scheduledFor"],
          properties: {
            revision: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
            state: { type: "string", enum: ["accepted", "completed", "dismissed"] },
            scheduledFor: localDateSchema,
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
        reply.send(
          await service.changeItemState(
            actor,
            request.params,
            request.params.itemId,
            request.body,
            request.id,
          ),
        );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
