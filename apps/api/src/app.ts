import { type HealthStatus, HTTP_API_VERSION } from "@family-health/contracts";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import type { ReadinessProbe } from "./database/pool.js";

export interface AppDependencies {
  readiness: ReadinessProbe;
  logger?: boolean;
}

export function buildApp({ readiness, logger = true }: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
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
