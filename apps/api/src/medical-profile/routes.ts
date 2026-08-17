import {
  MEDICAL_PROFILE_ENTRY_KINDS,
  type MedicalProfileEntryArchiveRequest,
  type MedicalProfileEntryCreateRequest,
  type MedicalProfileEntryUpdateRequest,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import type { MedicalProfileService } from "./medical-profile-service.js";

interface ProfileParams {
  familyId: string;
  profileId: string;
}

interface EntryParams extends ProfileParams {
  entryId: string;
}

const profileParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId"],
  properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
} as const;

const entryParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "entryId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    entryId: canonicalUuidSchema,
  },
} as const;

const localDateSchema = {
  anyOf: [{ type: "null" }, { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }],
} as const;
const valueSchema = { type: "string", minLength: 1, maxLength: 300 } as const;
const revisionSchema = { type: "integer", minimum: 1, maximum: 2_147_483_647 } as const;

const base = "/v1/families/:familyId/profiles/:profileId/medical-profile";

export function registerMedicalProfileRoutes(
  app: FastifyInstance,
  family: FamilyService,
  service: MedicalProfileService,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);

  app.get<{ Params: ProfileParams }>(
    base,
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

  app.put<{ Params: EntryParams; Body: MedicalProfileEntryCreateRequest }>(
    `${base}/entries/:entryId`,
    {
      schema: {
        params: entryParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "value", "recordedOn"],
          properties: {
            kind: { type: "string", enum: MEDICAL_PROFILE_ENTRY_KINDS },
            value: valueSchema,
            recordedOn: localDateSchema,
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
        const result = await service.createEntry(
          actor,
          request.params,
          request.params.entryId,
          request.body,
          request.id,
        );
        reply.code(result.created ? 201 : 200).send(result.response);
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.put<{ Params: EntryParams; Body: MedicalProfileEntryUpdateRequest }>(
    `${base}/entries/:entryId/value`,
    {
      schema: {
        params: entryParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["revision", "value", "recordedOn"],
          properties: { revision: revisionSchema, value: valueSchema, recordedOn: localDateSchema },
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
          await service.updateEntry(
            actor,
            request.params,
            request.params.entryId,
            request.body,
            request.id,
          ),
        );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.put<{ Params: EntryParams; Body: MedicalProfileEntryArchiveRequest }>(
    `${base}/entries/:entryId/archive`,
    {
      schema: {
        params: entryParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["revision"],
          properties: { revision: revisionSchema },
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
          await service.archiveEntry(
            actor,
            request.params,
            request.params.entryId,
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
