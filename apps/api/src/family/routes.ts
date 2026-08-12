import {
  type DemoRegistrationRequest,
  FAMILY_PROFILE_CONTRACT_VERSION,
  type PatientProfileKind,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import type { FamilyService } from "./family-service.js";

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
  properties: { familyId: canonicalUuidSchema },
} as const;

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
