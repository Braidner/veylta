import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantId, MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createAssistantService } from "../src/assistant/assistant-service.js";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeTurn,
} from "../src/assistant/codex-assistant-runtime.js";
import { registerAssistantRoutes } from "../src/assistant/routes.js";
import { createCarePlanService } from "../src/care-plan/care-plan-service.js";
import { registerCarePlanRoutes } from "../src/care-plan/routes.js";
import { createClinicianRecordService } from "../src/clinician-records/clinician-record-service.js";
import { registerClinicianRecordRoutes } from "../src/clinician-records/routes.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { registerDocumentDateRoutes } from "../src/documents/document-date-routes.js";
import { createDocumentService } from "../src/documents/document-service.js";
import { registerDocumentTimelineRoutes } from "../src/documents/document-timeline-routes.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import { createMedicalProfileService } from "../src/medical-profile/medical-profile-service.js";
import { registerMedicalProfileRoutes } from "../src/medical-profile/routes.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { scriptedOutput } from "./assistant-scripts.js";
import { type Identity, webOrigin } from "./medical-profile-app.js";

export const scriptedThreadId = "22222222-2222-4222-8222-222222222222";

export interface ScriptedRuntime {
  runtime: AssistantRuntime;
  turns: AssistantRuntimeTurn[];
  fail: { next: boolean };
}

/** Answers like the e2e stub: cites the ids it was given, interprets only for a ready profile. */
export function scriptedRuntime(): ScriptedRuntime {
  const turns: AssistantRuntimeTurn[] = [];
  const fail = { next: false };
  return {
    turns,
    fail,
    runtime: {
      async run(turn) {
        turns.push(turn);
        if (fail.next) {
          fail.next = false;
          throw new AssistantRuntimeError("gpt-test", 3, new Error("codex down"));
        }
        const output = scriptedOutput(
          turn.schema as Parameters<typeof scriptedOutput>[0],
          turn.prompt,
        );
        return {
          threadId: turn.threadId ?? scriptedThreadId,
          output: JSON.stringify(output),
          modelId: "gpt-test",
          runtimeVersion: "codex-cli 0.147.0",
          durationMs: 7,
        };
      },
    },
  };
}

export function assistantPath(identity: Identity, assistantId: AssistantId = "physician"): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/assistants/${assistantId}`;
}

export function carePlanPath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/care-plan`;
}

/** Family, documents, medical profile, care plan and the assistants over a scripted runtime. */
export async function startAssistantApp(): Promise<{
  app: FastifyInstance;
  database: Database;
  storageRoot: string;
  scripted: ScriptedRuntime;
  close: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "veylta-assistant-"));
  const database = createDatabase(join(root, "test.sqlite"));
  const storageRoot = join(root, "storage");
  await migrateUp(database);
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  const family = createFamilyService(database, {
    cookieName: "veylta_session",
    secureCookie: false,
    sessionTtlSeconds: 3_600,
  });
  registerFamilyRoutes(app, family, {
    allowedMutationOrigins: [webOrigin],
    demoRegistrationEnabled: true,
  });
  registerDocumentRoutes(
    app,
    family,
    createDocumentService(database, createLocalObjectStorage(storageRoot), {
      maxDocumentBytes: MAX_SYNTHETIC_DOCUMENT_BYTES,
    }),
    { allowedMutationOrigins: [webOrigin], maxDocumentBytes: MAX_SYNTHETIC_DOCUMENT_BYTES },
  );
  registerDocumentDateRoutes(app, family, database, { allowedMutationOrigins: [webOrigin] });
  registerDocumentTimelineRoutes(app, family, database);
  registerMedicalProfileRoutes(app, family, createMedicalProfileService(database), {
    allowedMutationOrigins: [webOrigin],
  });
  registerClinicianRecordRoutes(app, family, createClinicianRecordService(database), {
    allowedMutationOrigins: [webOrigin],
  });
  registerCarePlanRoutes(app, family, createCarePlanService(database), {
    allowedMutationOrigins: [webOrigin],
  });
  const scripted = scriptedRuntime();
  registerAssistantRoutes(app, family, createAssistantService(database, scripted.runtime), {
    allowedMutationOrigins: [webOrigin],
  });
  return {
    app,
    database,
    storageRoot,
    scripted,
    close: async () => {
      await app.close();
      await database.close();
      await rm(root, { force: true, recursive: true });
    },
  };
}
