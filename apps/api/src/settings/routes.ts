import {
  CODEX_REASONING_EFFORTS,
  CODEX_SERVICE_TIERS,
  type CodexPreferenceUpdateRequest,
  type ManagedAccountCreateRequest,
  type StorageRelocationRequest,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { FamilyService } from "../family/family-service.js";
import {
  errorEnvelope,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import {
  StorageRelocationFailedError,
  StorageRelocationNotSupportedError,
  StorageRelocationValidationError,
} from "../storage/storage-controller.js";
import type { HomeSettingsService } from "./home-settings-service.js";
import {
  CodexCatalogUnavailableError,
  CodexPreferenceUnsupportedError,
} from "./home-settings-service.js";

const usernameSchema = {
  type: "string",
  minLength: 3,
  maxLength: 32,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$",
} as const;

function sendSettingsError(
  error: unknown,
  requestId: string,
  reply: Parameters<typeof privateResponse>[0],
): boolean {
  if (error instanceof StorageRelocationValidationError) {
    reply
      .code(422)
      .send(
        errorEnvelope("INVALID_STORAGE_ROOT", "The storage root could not be accepted.", requestId),
      );
    return true;
  }
  if (error instanceof StorageRelocationNotSupportedError) {
    reply
      .code(409)
      .send(
        errorEnvelope(
          "STORAGE_RELOCATION_UNAVAILABLE",
          "Storage relocation is not available for this driver.",
          requestId,
        ),
      );
    return true;
  }
  if (error instanceof StorageRelocationFailedError) {
    reply
      .code(503)
      .send(
        errorEnvelope(
          error.code,
          "Storage relocation failed without switching the active root.",
          requestId,
        ),
      );
    return true;
  }
  if (error instanceof CodexCatalogUnavailableError) {
    reply
      .code(503)
      .send(
        errorEnvelope(
          "CODEX_CATALOG_UNAVAILABLE",
          "The local Codex model catalog is unavailable.",
          requestId,
        ),
      );
    return true;
  }
  if (error instanceof CodexPreferenceUnsupportedError) {
    reply
      .code(422)
      .send(
        errorEnvelope(
          "CODEX_PREFERENCE_UNSUPPORTED",
          "The selected Codex execution profile is unavailable.",
          requestId,
        ),
      );
    return true;
  }
  return false;
}

export function registerHomeSettingsRoutes(
  app: FastifyInstance,
  family: FamilyService,
  service: HomeSettingsService,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const allowedOrigins = new Set(options.allowedMutationOrigins);

  app.get("/v1/settings", async (request, reply) => {
    privateResponse(reply);
    const actor = await requireActor(family, request, reply);
    if (actor === null) return;
    try {
      reply.send(await service.get(actor));
    } catch (error) {
      if (!sendDomainError(error, request, reply)) throw error;
    }
  });

  app.post<{ Body: ManagedAccountCreateRequest }>(
    "/v1/settings/accounts",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "password", "displayName", "role"],
          properties: {
            username: usernameSchema,
            password: { type: "string", minLength: 12, maxLength: 128 },
            displayName: { type: "string", minLength: 1, maxLength: 120 },
            role: { type: "string", enum: ["admin", "user"] },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        reply.code(201).send(await service.createAccount(actor, request.body, request.id));
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.post<{ Body: StorageRelocationRequest }>(
    "/v1/settings/storage/relocate",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["rootPath"],
          properties: { rootPath: { type: "string", minLength: 2, maxLength: 2048 } },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        reply.send(await service.relocateStorage(actor, request.body.rootPath, request.id));
      } catch (error) {
        if (!sendSettingsError(error, request.id, reply) && !sendDomainError(error, request, reply))
          throw error;
      }
    },
  );

  app.post("/v1/settings/codex/start", async (request, reply) => {
    privateResponse(reply);
    if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
    const actor = await requireActor(family, request, reply);
    if (actor === null) return;
    try {
      reply.send(await service.startCodex(actor, request.id));
    } catch (error) {
      if (!sendDomainError(error, request, reply)) throw error;
    }
  });

  app.put<{ Body: CodexPreferenceUpdateRequest }>(
    "/v1/settings/codex/preferences",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "modelId",
            "documentModelId",
            "reasoningEffort",
            "documentReasoningEffort",
            "serviceTier",
          ],
          properties: {
            modelId: {
              type: "string",
              minLength: 2,
              maxLength: 80,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$",
            },
            documentModelId: {
              anyOf: [
                {
                  type: "string",
                  minLength: 2,
                  maxLength: 80,
                  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$",
                },
                { type: "null" },
              ],
            },
            reasoningEffort: { type: "string", enum: CODEX_REASONING_EFFORTS },
            documentReasoningEffort: { type: "string", enum: CODEX_REASONING_EFFORTS },
            serviceTier: { type: "string", enum: CODEX_SERVICE_TIERS },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      const actor = await requireActor(family, request, reply);
      if (actor === null) return;
      try {
        reply.send(await service.updateCodexPreference(actor, request.body, request.id));
      } catch (error) {
        if (!sendSettingsError(error, request.id, reply) && !sendDomainError(error, request, reply))
          throw error;
      }
    },
  );
}
