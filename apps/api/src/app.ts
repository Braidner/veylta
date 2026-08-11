import { type HealthStatus, HTTP_API_VERSION } from "@family-health/contracts";
import Fastify, { type FastifyError, type FastifyInstance, LogController } from "fastify";
import type { ReadinessProbe } from "./database/pool.js";

export interface AppDependencies {
  readiness: ReadinessProbe;
  logger?: boolean;
}

export function buildApp({ readiness, logger = true }: AppDependencies): FastifyInstance {
  const app = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
    bodyLimit: 65_536,
    logger,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.validation === undefined ? error.statusCode : 400;
    if (statusCode === 400) {
      reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request could not be accepted.",
          requestId: request.id,
          details: [],
        },
      });
      return;
    }
    if (statusCode === 413 || statusCode === 415) {
      reply.code(statusCode).send({
        error: {
          code: statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "UNSUPPORTED_MEDIA_TYPE",
          message: "The request could not be accepted.",
          requestId: request.id,
          details: [],
        },
      });
      return;
    }
    request.log.error(
      { errorCode: error.code, requestId: request.id },
      "request failed without exposing internal details",
    );
    reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: request.id,
        details: [],
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Resource not found.",
        requestId: request.id,
        details: [],
      },
    });
  });

  app.get(
    "/healthz",
    async (): Promise<HealthStatus> => ({
      status: "ok",
      service: "api",
      version: HTTP_API_VERSION,
    }),
  );

  app.get("/readyz", async (_request, reply): Promise<HealthStatus> => {
    try {
      await readiness.check();
      return { status: "ok", service: "api", version: HTTP_API_VERSION };
    } catch {
      reply.code(503);
      return { status: "unavailable", service: "api", version: HTTP_API_VERSION };
    }
  });

  return app;
}
