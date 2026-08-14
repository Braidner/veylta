import type { AdminSetupRequest, LoginRequest } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import {
  errorEnvelope,
  privateResponse,
  requireTrustedOrigin,
  sendDomainError,
} from "../http/route-helpers.js";
import { type AccountService, InvalidCredentialsError } from "./account-service.js";

const usernameSchema = {
  type: "string",
  minLength: 3,
  maxLength: 32,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$",
} as const;
const passwordSchema = { type: "string", minLength: 1, maxLength: 128 } as const;
const newPasswordSchema = { ...passwordSchema, minLength: 12 } as const;

export function registerAccountRoutes(
  app: FastifyInstance,
  service: AccountService,
  options: { allowedMutationOrigins: readonly string[] },
): void {
  const allowedOrigins = new Set(options.allowedMutationOrigins);

  app.get("/v1/setup", async (_request, reply) => {
    privateResponse(reply);
    reply.send(await service.getSetupStatus());
  });

  app.post<{ Body: AdminSetupRequest }>(
    "/v1/setup",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "password", "displayName"],
          properties: {
            username: usernameSchema,
            password: newPasswordSchema,
            displayName: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      try {
        const result = await service.setupAdmin(request.body, request.id);
        reply.header("set-cookie", result.cookie).code(201).send(result.response);
      } catch (error) {
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );

  app.post<{ Body: LoginRequest }>(
    "/v1/session",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "password"],
          properties: { username: usernameSchema, password: passwordSchema },
        },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      if (!requireTrustedOrigin(allowedOrigins, request, reply)) return;
      try {
        const result = await service.login(request.body, request.id);
        reply.header("set-cookie", result.cookie).send(result.response);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          reply
            .code(401)
            .send(
              errorEnvelope("INVALID_CREDENTIALS", "Invalid username or password.", request.id),
            );
          return;
        }
        if (!sendDomainError(error, request, reply)) throw error;
      }
    },
  );
}
