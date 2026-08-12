import type { FastifyReply, FastifyRequest } from "fastify";
import {
  DomainConflictError,
  DomainValidationError,
  type FamilyService,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";

export const canonicalUuidSchema = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

export function errorEnvelope(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId, details: [] } };
}

export function privateResponse(reply: FastifyReply): void {
  reply.header("cache-control", "no-store").header("vary", "Cookie");
}

export function sendDomainError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
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

export function requireTrustedOrigin(
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

export async function requireActor(
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
