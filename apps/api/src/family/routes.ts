import {
  type DemoInvitationAcceptRequest,
  type DemoRegistrationRequest,
  FAMILY_PROFILE_CONTRACT_VERSION,
  type FamilyInvitationCreateRequest,
  type PatientProfileKind,
  type ProfileConsentGrantCreateRequest,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import {
  canonicalUuidSchema,
  privateResponse,
  requireActor,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import type { FamilyAuditLogQuery, FamilyService } from "./family-service.js";

interface FamilyParams {
  familyId: string;
}

interface ProfileInput {
  displayName: string;
  kind: PatientProfileKind;
}

interface ProfileParams extends FamilyParams {
  profileId: string;
}

interface ConsentGrantParams extends ProfileParams {
  grantId: string;
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
const profileParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId"],
  properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
} as const;
const consentGrantParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "grantId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    grantId: canonicalUuidSchema,
  },
} as const;
const consentGrantInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["granteeUserId", "capability"],
  properties: {
    granteeUserId: canonicalUuidSchema,
    capability: { type: "string", const: "profile.read" },
  },
} as const;
const auditLogQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9][0-9]?|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 500, pattern: "^[A-Za-z0-9_-]+$" },
  },
} as const;
const invitationInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role"],
  properties: { role: { type: "string", enum: ["adult_member", "caregiver"] } },
} as const;
const invitationAcceptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "displayName"],
  properties: {
    code: { type: "string", minLength: 46, maxLength: 46, pattern: "^vi_[A-Za-z0-9_-]{43}$" },
    displayName: nameSchema,
    profileName: nameSchema,
  },
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

    app.post<{ Params: FamilyParams; Body: FamilyInvitationCreateRequest }>(
      "/v1/families/:familyId/invitations",
      { schema: { params: familyParamsSchema, body: invitationInputSchema } },
      async (request, reply) => {
        privateResponse(reply);
        if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
        const actor = await requireActor(service, request, reply);
        if (actor === null) return;
        try {
          reply
            .code(201)
            .send(
              await service.createInvitation(
                actor,
                request.params.familyId,
                request.body,
                request.id,
              ),
            );
        } catch (error) {
          if (!sendDomainError(error, request, reply)) throw error;
        }
      },
    );

    app.post<{ Body: DemoInvitationAcceptRequest }>(
      "/v1/demo/invitations/accept",
      { schema: { body: invitationAcceptSchema } },
      async (request, reply) => {
        privateResponse(reply);
        if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
        try {
          const result = await service.acceptDemoInvitation(request.body, request.id);
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

  app.get<{ Params: FamilyParams; Querystring: FamilyAuditLogQuery }>(
    "/v1/families/:familyId/audit-events",
    { schema: { params: familyParamsSchema, querystring: auditLogQuerySchema } },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(service, request, reply);
      if (actor === null) return;
      try {
        reply.send(
          await service.getAuditLog(actor, request.params.familyId, request.query, request.id),
        );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.get<{ Params: FamilyParams }>(
    "/v1/families/:familyId/members",
    { schema: { params: familyParamsSchema } },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(service, request, reply);
      if (actor === null) return;
      try {
        reply.send(await service.listConsentMembers(actor, request.params.familyId, request.id));
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.get<{ Params: ProfileParams }>(
    "/v1/families/:familyId/profiles/:profileId/consent-grants",
    { schema: { params: profileParamsSchema } },
    async (request, reply) => {
      privateResponse(reply);
      const actor = await requireActor(service, request, reply);
      if (actor === null) return;
      try {
        reply.send(await service.getProfileConsentGrants(actor, request.params, request.id));
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.post<{ Params: ProfileParams; Body: ProfileConsentGrantCreateRequest }>(
    "/v1/families/:familyId/profiles/:profileId/consent-grants",
    { schema: { params: profileParamsSchema, body: consentGrantInputSchema } },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      const actor = await requireActor(service, request, reply);
      if (actor === null) return;
      try {
        reply
          .code(201)
          .send(
            await service.createProfileConsentGrant(
              actor,
              request.params,
              request.body,
              request.id,
            ),
          );
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.delete<{ Params: ConsentGrantParams }>(
    "/v1/families/:familyId/profiles/:profileId/consent-grants/:grantId",
    { schema: { params: consentGrantParamsSchema } },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      const actor = await requireActor(service, request, reply);
      if (actor === null) return;
      try {
        await service.revokeProfileConsentGrant(actor, request.params, request.id);
        reply.code(204).send();
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

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
