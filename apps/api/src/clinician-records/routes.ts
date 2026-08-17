import { type ClinicianRecordDecisionRequest, MAX_CLINICIAN_RECORD_TEXT } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import type { ClinicianRecordService } from "./clinician-record-service.js";

interface DocumentParams {
  familyId: string;
  profileId: string;
  documentId: string;
}

interface RecordParams extends DocumentParams {
  resultKey: string;
}

const documentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "documentId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    documentId: canonicalUuidSchema,
  },
} as const;

const recordParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "documentId", "resultKey"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    documentId: canonicalUuidSchema,
    resultKey: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
  },
} as const;

const textSchema = { type: "string", minLength: 1, maxLength: MAX_CLINICIAN_RECORD_TEXT } as const;

const base = "/v1/families/:familyId/profiles/:profileId/documents/:documentId/clinician-records";

/** The clinician's statements of one document and the person's decisions over them. */
export function registerClinicianRecordRoutes(
  app: FastifyInstance,
  family: FamilyService,
  service: ClinicianRecordService,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const origins = new Set(options.allowedMutationOrigins);

  app.get<{ Params: DocumentParams }>(
    base,
    { schema: { params: documentParamsSchema } },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        const { documentId, ...scope } = request.params;
        reply.send(await service.list(actor, scope, documentId));
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.put<{ Params: RecordParams; Body: ClinicianRecordDecisionRequest }>(
    `${base}/:resultKey`,
    {
      schema: {
        params: recordParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["intelligenceResultId", "decision"],
          properties: {
            intelligenceResultId: {
              type: "string",
              minLength: 1,
              maxLength: 120,
              pattern: "^[A-Za-z0-9_-]+$",
            },
            decision: { type: "string", enum: ["confirm", "reject"] },
            correction: {
              type: "object",
              additionalProperties: false,
              required: ["label", "detail"],
              properties: {
                label: textSchema,
                detail: { anyOf: [{ type: "null" }, textSchema] },
              },
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
        const { documentId, resultKey, ...scope } = request.params;
        const result = await service.decide(
          actor,
          scope,
          documentId,
          resultKey,
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
