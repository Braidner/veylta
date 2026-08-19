import type { FastifyInstance } from "fastify";
import type { Database } from "../database/pool.js";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  sendDomainError,
} from "../http/route-helpers.js";
import { getDocumentTimeline } from "./document-timeline-service.js";

interface ProfileParams {
  familyId: string;
  profileId: string;
}

interface TimelineQuery {
  before?: string;
  limit?: string;
}

/** `GET /v1/families/:familyId/profiles/:profileId/documents/timeline?before=&limit=` — whole-day pages of reviewed documents. */
export function registerDocumentTimelineRoutes(
  app: FastifyInstance,
  family: FamilyService,
  database: Database,
): void {
  app.get<{ Params: ProfileParams; Querystring: TimelineQuery }>(
    "/v1/families/:familyId/profiles/:profileId/documents/timeline",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId", "profileId"],
          properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            // Shape only; the calendar day and the 1..MAX_DOCUMENT_TIMELINE_DAYS bound are the
            // service's 422, so the page size lives in the contract constant alone.
            before: { type: "string", minLength: 10, maxLength: 10 },
            limit: { type: "string", pattern: "^[0-9]{1,3}$" },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        reply.send(
          await getDocumentTimeline(database, {
            actor,
            scope: request.params,
            ...(request.query.before === undefined ? {} : { before: request.query.before }),
            ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
            correlationId: request.id,
          }),
        );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
