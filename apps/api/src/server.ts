import { createAccountService } from "./accounts/account-service.js";
import { registerAccountRoutes } from "./accounts/routes.js";
import { createCodexDocumentAgentRuntime } from "./agent/codex-document-agent-runtime.js";
import { createDocumentAgentCapabilityStore } from "./agent/document-agent-mcp.js";
import { createDocumentAgentService } from "./agent/document-agent-service.js";
import { registerDocumentAgentMcpRoute } from "./agent/mcp-route.js";
import { registerDocumentAgentRoutes } from "./agent/routes.js";
import { buildApp } from "./app.js";
import { createAssistantService } from "./assistant/assistant-service.js";
import { createCodexAssistantRuntime } from "./assistant/codex-assistant-runtime.js";
import { registerAssistantRoutes } from "./assistant/routes.js";
import { createCarePlanService } from "./care-plan/care-plan-service.js";
import { createCodexCarePlanGenerator } from "./care-plan/codex-care-plan-generator.js";
import { registerCarePlanRoutes } from "./care-plan/routes.js";
import { loadConfig } from "./config.js";
import { createDatabase, databaseReadiness } from "./database/pool.js";
import { createDocumentService } from "./documents/document-service.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { createFamilyService } from "./family/family-service.js";
import { registerFamilyRoutes } from "./family/routes.js";
import { createMedicalProfileService } from "./medical-profile/medical-profile-service.js";
import { registerMedicalProfileRoutes } from "./medical-profile/routes.js";
import { createCodexPreferencesStore } from "./settings/codex-preferences.js";
import { createCodexRuntimeProbe } from "./settings/codex-runtime.js";
import { createHomeSettingsService } from "./settings/home-settings-service.js";
import { registerHomeSettingsRoutes } from "./settings/routes.js";
import { createStorageController } from "./storage/storage-controller.js";

const config = loadConfig();
const database = createDatabase(config.databasePath);
const storage = createStorageController(database, config.objectStorage);
await storage.initialize();
const codexPreferences = createCodexPreferencesStore(database, config.codexDefaultPreference);
const resolveCodexExecutionProfile = () => codexPreferences.get();
const app = buildApp({ readiness: databaseReadiness(database) });
const familyService = createFamilyService(database, {
  cookieName: "veylta_session",
  secureCookie: config.secureSessionCookie,
  sessionTtlSeconds: config.sessionTtlSeconds,
});
const documentService = createDocumentService(database, storage, {
  maxDocumentBytes: config.maxDocumentBytes,
});
const documentAgentCapabilities = createDocumentAgentCapabilityStore({
  ttlMs: config.codexDocumentAgentTimeoutMs + 30_000,
});
const documentAgentService = createDocumentAgentService(
  database,
  documentService,
  createCodexDocumentAgentRuntime({
    mcpUrl: `http://127.0.0.1:${config.apiPort}/mcp/document-agent`,
    resolveExecutionProfile: resolveCodexExecutionProfile,
    timeoutMs: config.codexDocumentAgentTimeoutMs,
  }),
  documentAgentCapabilities,
);
registerAccountRoutes(
  app,
  createAccountService(database, {
    cookieName: "veylta_session",
    secureCookie: config.secureSessionCookie,
    sessionTtlSeconds: config.sessionTtlSeconds,
  }),
  { allowedMutationOrigins: config.webOrigins },
);
registerFamilyRoutes(app, familyService, {
  allowedMutationOrigins: config.webOrigins,
  demoRegistrationEnabled: config.demoRegistrationEnabled,
});
registerHomeSettingsRoutes(
  app,
  familyService,
  createHomeSettingsService(database, storage, createCodexRuntimeProbe(), codexPreferences),
  { allowedMutationOrigins: config.webOrigins },
);
registerMedicalProfileRoutes(app, familyService, createMedicalProfileService(database), {
  allowedMutationOrigins: config.webOrigins,
});
registerAssistantRoutes(
  app,
  familyService,
  createAssistantService(
    database,
    createCodexAssistantRuntime({
      resolveExecutionProfile: resolveCodexExecutionProfile,
      timeoutMs: config.codexAssistantTimeoutMs,
    }),
  ),
  { allowedMutationOrigins: config.webOrigins },
);
registerCarePlanRoutes(
  app,
  familyService,
  createCarePlanService(database, {
    generator: createCodexCarePlanGenerator({
      resolveExecutionProfile: resolveCodexExecutionProfile,
      timeoutMs: config.codexCarePlanTimeoutMs,
    }),
    leaseDurationMs: config.codexCarePlanTimeoutMs + 30_000,
  }),
  {
    allowedMutationOrigins: config.webOrigins,
  },
);
registerDocumentRoutes(app, familyService, documentService, {
  allowedMutationOrigins: config.webOrigins,
  maxDocumentBytes: config.maxDocumentBytes,
});
registerDocumentAgentRoutes(app, familyService, documentAgentService, {
  allowedMutationOrigins: config.webOrigins,
});
registerDocumentAgentMcpRoute(app, documentAgentCapabilities, documentAgentService);

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
