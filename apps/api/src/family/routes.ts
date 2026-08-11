import {
  type DemoRegistrationRequest,
  FAMILY_PROFILE_CONTRACT_VERSION,
  type PatientProfileKind,
} from "@family-health/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DomainConflictError,
  DomainValidationError,
  type FamilyService,
  ResourceNotFoundError,
  type SessionActor,
} from "./family-service.js";

interface FamilyParams {
  familyId: string;
}

interface ProfileInput {
  displayName: string;
  kind: PatientProfileKind;
}

export interface FamilyRouteOptions {
  allowedMutationOrigins: readonly string[];
  demoRegistrationEnabled: boolean;
}

const nameSchema = { type: "string", minLength: 1, maxLength: 120 } as const;
const familyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId"],
  properties: { familyId: { type: "string", format: "uuid" } },
} as const;

function errorEnvelope(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId, details: [] } };
}

function privateResponse(reply: FastifyReply): void {
  reply.header("cache-control", "no-store").header("vary", "Cookie");
}

function sendDomainError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof ResourceNotFoundError) {
    reply.code(404).send(errorEnvelope("RESOURCE_NOT_FOUND", "Resource not found.", request.id));
    return true;
  }
  if (error instanceof DomainConflictError) {
    reply
      .code(409)
      .send(errorEnvelope("CONFLICT", "The request conflicts with current state.", request.id));
    return true;
  }
  if (error instanceof DomainValidationError) {
    reply
      .code(422)
      .send(
        errorEnvelope("DOMAIN_VALIDATION_ERROR", "The request could not be accepted.", request.id),
      );
    return true;
  }
  return false;
}

function requireTrustedOrigin(
  allowedOrigins: ReadonlySet<string>,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const origin = request.headers.origin;
  if (origin !== undefined && allowedOrigins.has(origin)) return true;
  reply
    .code(403)
    .send(errorEnvelope("ORIGIN_NOT_ALLOWED", "Request origin is not allowed.", request.id));
  return false;
}

async function requireActor(
  service: FamilyService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionActor | null> {
  const actor = await service.authenticate(request.headers.cookie);
  if (actor === null) {
    reply
      .code(401)
      .send(errorEnvelope("AUTHENTICATION_REQUIRED", "Authentication required.", request.id));
  }
  return actor;
}

export function registerFamilyRoutes(
  app: FastifyInstance,
  service: FamilyService,
  options: FamilyRouteOptions,
): void {
  const allowedOrigins = new Set(options.allowedMutationOrigins);

  if (options.demoRegistrationEnabled) {
    app.post<{ Body: DemoRegistrationRequest }>(
      "/v1/demo/registrations",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["displayName", "familyName", "profileName"],
            properties: {
              displayName: nameSchema,
              familyName: nameSchema,
              profileName: nameSchema,
            },
          },
        },
      },
      async (request, reply) => {
        privateResponse(reply);
        if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
        try {
          const result = await service.registerDemo(request.body, request.id);
          reply.header("set-cookie", result.cookie).code(201).send(result.response);
        } catch (error) {
          if (!sendDomainError(error, request, reply)) throw error;
        }
      },
    );
  }

  app.get("/v1/session", async (request, reply) => {
    privateResponse(reply);
    const actor = await requireActor(service, request, reply);
    if (actor === null) return;
    reply.send(await service.getSession(actor));
  });

  app.delete("/v1/session", async (request, reply) => {
    privateResponse(reply);
    if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
    const actor = await requireActor(service, request, reply);
    if (actor === null) return;
    await service.logout(actor, request.id);
    reply.header("set-cookie", service.clearSessionCookie()).code(204).send();
  });

  app.get<{ Params: FamilyParams }>(
    "/v1/families/:familyId/profiles",
    { schema: { params: familyParamsSchema } },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(service, request, reply);
      if (actor === null) return;
      try {
        const items = await service.listProfiles(actor, request.params.familyId);
        reply.send({ contractVersion: FAMILY_PROFILE_CONTRACT_VERSION, items });
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.post<{ Params: FamilyParams; Body: ProfileInput }>(
    "/v1/families/:familyId/profiles",
    {
      schema: {
        params: familyParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["displayName", "kind"],
          properties: {
            displayName: nameSchema,
            kind: { type: "string", enum: ["adult", "dependent"] },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      const actor = await requireActor(service, request, reply);
      if (actor === null) return;
      try {
        const profile = await service.createProfile(
          actor,
          request.params.familyId,
          request.body,
          request.id,
        );
        reply.code(201).send({ contractVersion: FAMILY_PROFILE_CONTRACT_VERSION, profile });
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
