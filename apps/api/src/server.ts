import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, databaseReadiness } from "./database/pool.js";
import { createDocumentService } from "./documents/document-service.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { createFamilyService } from "./family/family-service.js";
import { registerFamilyRoutes } from "./family/routes.js";
import { createLocalObjectStorage } from "./storage/local-object-storage.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);
const app = buildApp({ readiness: databaseReadiness(database) });
const familyService = createFamilyService(database, {
  cookieName: "fh_session",
  secureCookie: config.secureSessionCookie,
  sessionTtlSeconds: config.sessionTtlSeconds,
});
registerFamilyRoutes(app, familyService, {
  allowedMutationOrigins: [config.webOrigin],
  demoRegistrationEnabled: config.demoRegistrationEnabled,
});
registerDocumentRoutes(
  app,
  familyService,
  createDocumentService(database, createLocalObjectStorage(config.objectStorageRoot), {
    maxPdfBytes: config.maxPdfBytes,
  }),
  {
    allowedMutationOrigins: [config.webOrigin],
    maxPdfBytes: config.maxPdfBytes,
  },
);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "api shutdown requested");
  await app.close();
  await database.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

app.listen({ host: config.apiHost, port: config.apiPort }).catch(async (error: unknown) => {
  app.log.error({ error }, "api failed to start");
  await database.close();
  process.exitCode = 1;
});
