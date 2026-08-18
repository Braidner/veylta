import {
  CARE_PLAN_CHECKIN_STATUSES,
  type CarePlanCheckinRequest,
  type CarePlanItemCreateRequest,
  type CarePlanItemStateRequest,
  type CarePlanProposalRequest,
  MAX_CARE_PLAN_CHECKIN_NOTE_LENGTH,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import {
  type CheckinParams,
  checkinParamsSchema,
  type ItemParams,
  itemParamsSchema,
  localDateSchema,
  type ProfileParams,
  profileParamsSchema,
} from "./care-plan-route-schemas.js";
import { CarePlanProposalGenerationError, type CarePlanService } from "./care-plan-service.js";

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

  app.post<{ Params: ProfileParams; Body: CarePlanProposalRequest }>(
    "/v1/families/:familyId/profiles/:profileId/care-plan/proposals",
    {
      schema: {
        params: profileParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["acknowledgement"],
          properties: {
            acknowledgement: {
              type: "string",
              const: "send_confirmed_summary_to_codex",
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
        const response = await service.generateProposals(actor, request.params, request.id);
        reply.code(response.replayed ? 200 : 201).send(response);
      } catch (error) {
        if (error instanceof CarePlanProposalGenerationError) {
          reply.code(503).send({
            error: {
              code: error.code,
              message: "Codex could not create bounded care-plan drafts.",
              correlationId: request.id,
            },
          });
          return;
        }
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

  app.put<{ Params: CheckinParams; Body: CarePlanCheckinRequest }>(
    "/v1/families/:familyId/profiles/:profileId/care-plan/items/:itemId/checkins/:date",
    {
      schema: {
        params: checkinParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status", "note"],
          properties: {
            status: { type: "string", enum: [...CARE_PLAN_CHECKIN_STATUSES] },
            note: {
              anyOf: [
                { type: "null" },
                { type: "string", minLength: 1, maxLength: MAX_CARE_PLAN_CHECKIN_NOTE_LENGTH },
              ],
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
        const result = await service.recordCheckin(
          actor,
          request.params,
          request.params.itemId,
          request.params.date,
          request.body,
          request.id,
        );
        reply.code(result.created ? 201 : 200).send(result.response);
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
