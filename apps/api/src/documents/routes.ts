import multipart from "@fastify/multipart";
import {
  DOCUMENT_CONTRACT_VERSION,
  FACT_REVIEW_COMMAND_SCHEMA,
  type FactReviewCommand,
} from "@veylta/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  canonicalUuidSchema,
  errorEnvelope,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import {
  type DocumentService,
  IdempotencyConflictError,
  type IndicatorSeriesQuery,
  InvalidDocumentSignatureError,
  type ObservationHistoryQuery,
  type StagedDocument,
  UnsupportedDocumentTypeError,
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

class InvalidMultipartUploadError extends Error {}
class InvalidIdempotencyKeyError extends Error {}

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

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || !/^[\x21-\x7e]{16,200}$/.test(value)) {
    throw new InvalidIdempotencyKeyError();
  }
  return value;
}

async function drain(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const _chunk of stream) {
    // Deliberately discard invalid multipart content without buffering it.
  }
}

function isMultipartLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"].includes(
      String((error as { code: unknown }).code),
    )
  );
}

function isMultipartParseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error &&
      ["FST_INVALID_MULTIPART_CONTENT_TYPE", "FST_MULTIPART_INVALID_MEDIA_TYPE"].includes(
        String((error as { code: unknown }).code),
      )) ||
      error.name === "MultipartError" ||
      /^Unexpected end of (form|multipart data)$/.test(error.message))
  );
}

function sendDocumentError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof UnsupportedDocumentTypeError) {
    reply
      .code(415)
      .send(
        errorEnvelope(
          "UNSUPPORTED_DOCUMENT_TYPE",
          "Only a synthetic PDF, PNG, or JPEG is supported.",
          request.id,
        ),
      );
    return true;
  }
  if (error instanceof InvalidDocumentSignatureError) {
    reply
      .code(415)
      .send(
        errorEnvelope(
          "INVALID_DOCUMENT_SIGNATURE",
          "The file content does not match a supported document type.",
          request.id,
        ),
      );
    return true;
  }
  if (error instanceof UploadTooLargeError) {
    reply
      .code(413)
      .send(
        errorEnvelope("UPLOAD_TOO_LARGE", "The document exceeds the upload limit.", request.id),
      );
    return true;
  }
  if (error instanceof IdempotencyConflictError) {
    reply
      .code(409)
      .send(
        errorEnvelope(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for another upload.",
          request.id,
        ),
      );
    return true;
  }
  if (error instanceof InvalidIdempotencyKeyError) {
    reply
      .code(400)
      .send(
        errorEnvelope(
          "INVALID_IDEMPOTENCY_KEY",
          "A valid Idempotency-Key header is required.",
          request.id,
        ),
      );
    return true;
  }
  if (
    error instanceof InvalidMultipartUploadError ||
    isMultipartLimitError(error) ||
    isMultipartParseError(error)
  ) {
    reply
      .code(400)
      .send(
        errorEnvelope(
          "INVALID_MULTIPART_UPLOAD",
          "Exactly one supported document file part is required.",
          request.id,
        ),
      );
    return true;
  }
  return sendDomainError(error, request, reply);
}

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
        bodyLimit: options.maxDocumentBytes + 128 * 1024,
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

          const document = await service.acceptUpload(
            actor,
            request.params,
            staged,
            commandKey,
            request.id,
          );
          reply.code(202).send({ contractVersion: DOCUMENT_CONTRACT_VERSION, document });
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        } finally {
          if (staged !== null) await service.discardStaged(staged).catch(() => undefined);
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
          const filename =
            content.contentType === "application/pdf"
              ? "document.pdf"
              : content.contentType === "image/png"
                ? "document.png"
                : "document.jpg";
          return reply
            .type(content.contentType)
            .header("content-length", content.byteSize)
            .header("content-disposition", `attachment; filename="${filename}"`)
            .header("x-content-type-options", "nosniff")
            .header("cache-control", "private, no-store")
            .header("content-security-policy", "sandbox")
            .send(content.body);
        } catch (error) {
          if (!sendDocumentError(error, request, reply)) throw error;
        }
      },
    );

    scope.get<{ Params: DocumentParams }>(
      "/v1/families/:familyId/profiles/:profileId/documents/:documentId/processing",
      { schema: { params: documentParamsSchema } },
      async (request, reply) => {
        privateResponse(reply);
        const actor = await requireActor(familyService, request, reply);
        if (actor === null) return;
        try {
          reply.send(await service.getProcessing(actor, request.params, request.id));
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
  });
}
