import multipart from "@fastify/multipart";
import {
  DOCUMENT_CONTRACT_VERSION,
  FACT_REVIEW_COMMAND_SCHEMA,
  type FactReviewCommand,
  SYNTHETIC_DOCUMENT_MULTIPART_OVERHEAD_BYTES,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  idempotencyKey,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
} from "../http/route-helpers.js";
import {
  attachmentDisposition,
  InvalidMultipartUploadError,
  sendDocumentError,
} from "./document-route-errors.js";
import {
  type DocumentProcessingQuery,
  type DocumentSearchQuery,
  type DocumentService,
  type HealthSummaryComparisonQuery,
  type HealthSummaryHistoryQuery,
  type HealthSummaryQuery,
  type IndicatorSeriesQuery,
  type ObservationHistoryQuery,
  type StagedDocument,
  UploadTooLargeError,
} from "./document-service.js";

interface ProfileParams {
  familyId: string;
  profileId: string;
}

interface DocumentParams extends ProfileParams {
  documentId: string;
}

interface FactParams extends DocumentParams {
  factId: string;
}

interface IndicatorParams extends ProfileParams {
  canonicalCode: string;
}

export interface DocumentRouteOptions {
  allowedMutationOrigins: readonly string[];
  maxDocumentBytes: number;
}

async function drain(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const _chunk of stream) {
    // Deliberately discard invalid multipart content without buffering it.
  }
}

const profileParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
  },
} as const;

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

const factParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "documentId", "factId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    documentId: canonicalUuidSchema,
    factId: { type: "string", pattern: "^fact_[a-f0-9]{40}$" },
  },
} as const;

const observationHistoryQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    canonicalCode: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-z0-9][a-z0-9._-]{0,99}$",
    },
    limit: { type: "string", pattern: "^(?:[1-9][0-9]?|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 500, pattern: "^[A-Za-z0-9_-]+$" },
  },
} as const;

const documentSearchQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["q"],
  properties: {
    q: {
      type: "string",
      minLength: 2,
      maxLength: 120,
      pattern: "^(?=.*\\S)[^\\u0000-\\u001F\\u007F]+$",
    },
    limit: { type: "string", pattern: "^(?:[1-9]|[1-4][0-9]|50)$" },
  },
} as const;

const processingQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    runId: canonicalUuidSchema,
  },
} as const;

const healthSummaryQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", pattern: "^[1-9][0-9]{0,8}$" },
  },
} as const;

const healthSummaryHistoryQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    beforeVersion: { type: "string", pattern: "^[1-9][0-9]{0,8}$" },
    limit: { type: "string", pattern: "^(?:[1-9]|[1-4][0-9]|50)$" },
  },
} as const;

const healthSummaryComparisonQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["fromVersion", "toVersion"],
  properties: {
    fromVersion: { type: "string", pattern: "^[1-9][0-9]{0,8}$" },
    toVersion: { type: "string", pattern: "^[1-9][0-9]{0,8}$" },
  },
} as const;

const indicatorParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "canonicalCode"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    canonicalCode: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-z0-9][a-z0-9._-]{0,99}$",
    },
  },
} as const;

const indicatorSeriesQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["unit"],
  properties: {
    unit: { type: "string", minLength: 1, maxLength: 100 },
    limit: { type: "string", pattern: "^(?:[1-9][0-9]?|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 500, pattern: "^[A-Za-z0-9_-]+$" },
  },
} as const;

export function registerDocumentRoutes(
  app: FastifyInstance,
  familyService: FamilyService,
  service: DocumentService,
  options: DocumentRouteOptions,
): void {
  const allowedOrigins = new Set(options.allowedMutationOrigins);

  app.register(async (scope) => {
    await scope.register(multipart, {
      attachFieldsToBody: false,
      throwFileSizeLimit: false,
      limits: {
        files: 2,
        fields: 1,
        parts: 3,
        fileSize: options.maxDocumentBytes,
        fieldNameSize: 32,
        headerPairs: 32,
      },
    });

    scope.get<{ Params: ProfileParams; Querystring: ObservationHistoryQuery }>(
      "/v1/families/:familyId/profiles/:profileId/observations",
      { schema: { params: profileParamsSchema, querystring: observationHistoryQuerySchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(
            await service.getObservationHistory(actor, request.params, request.query, request.id),
          );
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: ProfileParams }>(
      "/v1/families/:familyId/profiles/:profileId/overview",
      { schema: { params: profileParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(await service.getProfileOverview(actor, request.params, request.id));
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: ProfileParams; Querystring: HealthSummaryQuery }>(
      "/v1/families/:familyId/profiles/:profileId/health-summary",
      { schema: { params: profileParamsSchema, querystring: healthSummaryQuerySchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(
            await service.getHealthSummary(actor, request.params, request.query, request.id),
          );
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: ProfileParams; Querystring: HealthSummaryHistoryQuery }>(
      "/v1/families/:familyId/profiles/:profileId/health-summary/versions",
      { schema: { params: profileParamsSchema, querystring: healthSummaryHistoryQuerySchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(
            await service.getHealthSummaryHistory(actor, request.params, request.query, request.id),
          );
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: ProfileParams; Querystring: HealthSummaryComparisonQuery }>(
      "/v1/families/:familyId/profiles/:profileId/health-summary/compare",
      { schema: { params: profileParamsSchema, querystring: healthSummaryComparisonQuerySchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(
            await service.getHealthSummaryComparison(
              actor,
              request.params,
              request.query,
              request.id,
            ),
          );
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: ProfileParams }>(
      "/v1/families/:familyId/profiles/:profileId/evidence-bundle",
      { schema: { params: profileParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          const bundle = await service.getEvidenceBundle(actor, request.params, request.id);
          return reply
            .type("application/x-tar")
            .header("content-length", bundle.byteSize)
            .header("content-disposition", 'attachment; filename="veylta-synthetic-evidence.tar"')
            .header("x-content-type-options", "nosniff")
            .header("cache-control", "private, no-store")
            .header("content-security-policy", "sandbox")
            .send(bundle.body);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: ProfileParams }>(
      "/v1/families/:familyId/profiles/:profileId/portable-export",
      { schema: { params: profileParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          const archive = await service.getPortableProfileExport(actor, request.params, request.id);
          return reply
            .type("application/x-tar")
            .header("content-length", archive.byteSize)
            .header("content-disposition", 'attachment; filename="veylta-synthetic-profile.tar"')
            .header("x-content-type-options", "nosniff")
            .header("cache-control", "private, no-store")
            .header("content-security-policy", "sandbox")
            .send(archive.body);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: ProfileParams }>(
      "/v1/families/:familyId/profiles/:profileId/indicators",
      { schema: { params: profileParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(await service.getIndicatorCatalog(actor, request.params, request.id));
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: IndicatorParams; Querystring: IndicatorSeriesQuery }>(
      "/v1/families/:familyId/profiles/:profileId/indicators/:canonicalCode",
      { schema: { params: indicatorParamsSchema, querystring: indicatorSeriesQuerySchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(
            await service.getIndicatorSeries(actor, request.params, request.query, request.id),
          );
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.post<{ Params: ProfileParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents",
      {
        bodyLimit: options.maxDocumentBytes + SYNTHETIC_DOCUMENT_MULTIPART_OVERHEAD_BYTES,
        schema: { params: profileParamsSchema },
      },
      async (request, reply) => {
        privateResponse(reply);
        let staged: StagedDocument | null = null;
        try {
          if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
          const actor = await requireActor(familyService, request, reply);
          if (actor === null) return;
          const commandKey = idempotencyKey(request);
          await service.requireProfileWriteAccess(actor, request.params);

          let invalidShape = false;
          for await (const part of request.parts()) {
            if (part.type !== "file") {
              invalidShape = true;
              continue;
            }
            if (invalidShape || staged !== null || part.fieldname !== "file") {
              invalidShape = true;
              await drain(part.file);
              continue;
            }
            staged = await service.stageDocument({
              body: part.file,
              contentType: part.mimetype,
              filename: part.filename,
            });
            if (part.file.truncated) throw new UploadTooLargeError();
          }
          if (staged === null || invalidShape) throw new InvalidMultipartUploadError();

          const accepted = await service.acceptUpload(
            actor,
            request.params,
            staged,
            commandKey,
            request.id,
          );
          reply.code(accepted.disposition === "created" ? 202 : 200).send({
            contractVersion: DOCUMENT_CONTRACT_VERSION,
            disposition: accepted.disposition,
            document: accepted.document,
          });
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        } finally {
          if (staged !== null) await service.discardStaged(staged).catch(() => undefined);
        }
      },
    );

    scope.get<{ Params: ProfileParams; Querystring: DocumentSearchQuery }>(
      "/v1/families/:familyId/profiles/:profileId/documents",
      { schema: { params: profileParamsSchema, querystring: documentSearchQuerySchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(
            await service.searchDocuments(actor, request.params, request.query, request.id),
          );
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: DocumentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId",
      { schema: { params: documentParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          const document = await service.getDocument(actor, request.params, request.id);
          reply.send({ contractVersion: DOCUMENT_CONTRACT_VERSION, document });
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: DocumentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/content",
      { schema: { params: documentParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          const content = await service.getContent(actor, request.params, request.id);
          return reply
            .type(content.contentType)
            .header("content-length", content.byteSize)
            .header("content-disposition", attachmentDisposition(content.originalFilename))
            .header("x-content-type-options", "nosniff")
            .header("cache-control", "private, no-store")
            .header("content-security-policy", "sandbox")
            .send(content.body);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.delete<{ Params: DocumentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId",
      { schema: { params: documentParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        try {
          if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
          const actor = await requireActor(familyService, request, reply);
          if (actor === null) return;
          const result = await service.deleteDocument(
            actor,
            request.params,
            idempotencyKey(request),
            request.id,
          );
          reply.code(200).send(result.response);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: DocumentParams; Querystring: DocumentProcessingQuery }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/processing",
      { schema: { params: documentParamsSchema, querystring: processingQuerySchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(await service.getProcessing(actor, request.params, request.query, request.id));
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: DocumentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/facts",
      { schema: { params: documentParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(await service.getFacts(actor, request.params, request.id));
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.post<{ Params: FactParams; Body: FactReviewCommand }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/facts/:factId/review",
      { schema: { params: factParamsSchema, body: FACT_REVIEW_COMMAND_SCHEMA } },
      async (request, reply) => {
        privateResponse(reply);
        try {
          if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
          const actor = await requireActor(familyService, request, reply);
          if (actor === null) return;
          const result = await service.reviewFact(
            actor,
            request.params,
            request.body,
            idempotencyKey(request),
            request.id,
          );
          reply.code(result.replayed ? 200 : 201).send(result.response);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.post<{ Params: DocumentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/processing/retry",
      { schema: { params: documentParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        try {
          if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
          const actor = await requireActor(familyService, request, reply);
          if (actor === null) return;
          const commandKey = idempotencyKey(request);
          const processing = await service.retryProcessing(
            actor,
            request.params,
            commandKey,
            request.id,
          );
          reply.code(202).send(processing);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.post<{ Params: DocumentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/processing/restart",
      { schema: { params: documentParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        try {
          if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
          const actor = await requireActor(familyService, request, reply);
          if (actor === null) return;
          const processing = await service.restartProcessing(
            actor,
            request.params,
            idempotencyKey(request),
            request.id,
          );
          reply.code(202).send(processing);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );
  });
}
