import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, databaseReadiness } from "./database/pool.js";
import { createFamilyService } from "./family/family-service.js";
import { registerFamilyRoutes } from "./family/routes.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = buildApp({ readiness: databaseReadiness(pool) });
registerFamilyRoutes(
  app,
  createFamilyService(pool, {
    cookieName: "fh_session",
    secureCookie: config.secureSessionCookie,
    sessionTtlSeconds: config.sessionTtlSeconds,
  }),
  {
    allowedMutationOrigins: [config.webOrigin],
    demoRegistrationEnabled: config.demoRegistrationEnabled,
  },
);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "api shutdown requested");
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

app.listen({ host: config.apiHost, port: config.apiPort }).catch(async (error: unknown) => {
  app.log.error({ error }, "api failed to start");
  await pool.end();
  process.exitCode = 1;
});
