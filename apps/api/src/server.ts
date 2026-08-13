import { createAccountService } from "./accounts/account-service.js";
import { registerAccountRoutes } from "./accounts/routes.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, databaseReadiness } from "./database/pool.js";
import { createDocumentService } from "./documents/document-service.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { createFamilyService } from "./family/family-service.js";
import { registerFamilyRoutes } from "./family/routes.js";
import { createCodexRuntimeProbe } from "./settings/codex-runtime.js";
import { createHomeSettingsService } from "./settings/home-settings-service.js";
import { registerHomeSettingsRoutes } from "./settings/routes.js";
import { createStorageController } from "./storage/storage-controller.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);
const storage = createStorageController(database, config.objectStorage);
await storage.initialize();
const app = buildApp({ readiness: databaseReadiness(database) });
const familyService = createFamilyService(database, {
  cookieName: "veylta_session",
  secureCookie: config.secureSessionCookie,
  sessionTtlSeconds: config.sessionTtlSeconds,
});
registerAccountRoutes(
  app,
  createAccountService(database, {
    cookieName: "veylta_session",
    secureCookie: config.secureSessionCookie,
    sessionTtlSeconds: config.sessionTtlSeconds,
  }),
  { allowedMutationOrigins: [config.webOrigin] },
);
registerFamilyRoutes(app, familyService, {
  allowedMutationOrigins: [config.webOrigin],
  demoRegistrationEnabled: config.demoRegistrationEnabled,
});
registerHomeSettingsRoutes(
  app,
  familyService,
  createHomeSettingsService(database, storage, createCodexRuntimeProbe()),
  { allowedMutationOrigins: [config.webOrigin] },
);
registerDocumentRoutes(
  app,
  familyService,
  createDocumentService(database, storage, {
    maxDocumentBytes: config.maxDocumentBytes,
  }),
  {
    allowedMutationOrigins: [config.webOrigin],
    maxDocumentBytes: config.maxDocumentBytes,
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
