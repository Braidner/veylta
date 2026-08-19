import type { DocumentDateRequest } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "../database/pool.js";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import { setDocumentDate } from "./document-date-service.js";

interface DocumentParams {
  familyId: string;
  profileId: string;
  documentId: string;
}

/** `PUT /v1/families/:familyId/profiles/:profileId/documents/:documentId/date` — the person's correction of the date. */
export function registerDocumentDateRoutes(
  app: FastifyInstance,
  family: FamilyService,
  database: Database,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);
  app.put<{ Params: DocumentParams; Body: DocumentDateRequest }>(
    "/v1/families/:familyId/profiles/:profileId/documents/:documentId/date",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId", "profileId", "documentId"],
          properties: {
            familyId: canonicalUuidSchema,
            profileId: canonicalUuidSchema,
            documentId: canonicalUuidSchema,
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["documentDate"],
          // Shape only; the calendar and the "not after tomorrow" bound are the service's 422.
          properties: { documentDate: { type: ["string", "null"], minLength: 10, maxLength: 10 } },
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
          await setDocumentDate(database, {
            actor,
            scope: request.params,
            documentDate: request.body.documentDate,
            correlationId: request.id,
          }),
        );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
