import type { ProfileHandleRequest } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "../database/pool.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import type { FamilyService } from "./family-service.js";
import { setProfileHandle } from "./profile-handle-service.js";

interface ProfileParams {
  familyId: string;
  profileId: string;
}

/** `PUT /v1/families/:familyId/profiles/:profileId/handle` — the person's own name for their page. */
export function registerProfileHandleRoutes(
  app: FastifyInstance,
  family: FamilyService,
  database: Database,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);
  app.put<{ Params: ProfileParams; Body: ProfileHandleRequest }>(
    "/v1/families/:familyId/profiles/:profileId/handle",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId", "profileId"],
          properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["handle"],
          properties: {
            // Only a sane size here: the pattern and the reserved words are the service's 422,
            // so a two-letter or a Cyrillic handle gets the same answer as a reserved one.
            handle: { type: "string", minLength: 1, maxLength: 64 },
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
          await setProfileHandle(database, {
            actor,
            scope: request.params,
            handle: request.body.handle,
            correlationId: request.id,
          }),
        );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
