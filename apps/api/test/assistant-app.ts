import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createAssistantService } from "../src/assistant/assistant-service.js";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeTurn,
} from "../src/assistant/codex-assistant-runtime.js";
import { registerAssistantRoutes } from "../src/assistant/routes.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { createDocumentService } from "../src/documents/document-service.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import { createMedicalProfileService } from "../src/medical-profile/medical-profile-service.js";
import { registerMedicalProfileRoutes } from "../src/medical-profile/routes.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { type Identity, webOrigin } from "./medical-profile-app.js";

export const scriptedThreadId = "22222222-2222-4222-8222-222222222222";

export interface ScriptedRuntime {
  runtime: AssistantRuntime;
  turns: AssistantRuntimeTurn[];
  fail: { next: boolean };
}

/** A persona's scripted read: the endocrinologist alarms sooner than everyone else. */
function specialistOutput(specialty: string, prompt: string): unknown {
  const ids = [...prompt.matchAll(/"observationId":"([0-9a-f-]{36})"/g)].map((match) => match[1]);
  const ref = ids[0] === undefined ? [] : [{ observationId: ids[0] }];
  const soon = specialty === "endocrinologist";
  return {
    urgency: { tier: soon ? "soon" : "routine", reasons: ref },
    blocks: [
      {
        kind: "hypothesis",
        name: soon ? "Синтетический субклинический гипотиреоз" : "Синтетическая лёгкая анемия",
        confidence: soon ? "moderate" : "low",
        rationale: "Значение вне напечатанного диапазона; нужна динамика.",
        refs: ref,
        confirmWith: specialty,
        workup: ["Повторить через 6 недель"],
      },
    ],
  };
}

/** The therapist's scripted synthesis: the highest urgency of the opinions and one disagreement. */
function synthesisOutput(prompt: string): unknown {
  const opinions = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as Array<{
    specialty: string;
    answer: { urgency: { tier: string } } | null;
  }>;
  const tiers = ["none", "routine", "soon", "urgent", "emergency"];
  const tier = opinions.reduce(
    (best, item) =>
      item.answer !== null && tiers.indexOf(item.answer.urgency.tier) > tiers.indexOf(best)
        ? item.answer.urgency.tier
        : best,
    "none",
  );
  const ids = [...prompt.matchAll(/"observationId":"([0-9a-f-]{36})"/g)].map((match) => match[1]);
  const ref = ids[0] === undefined ? [] : [{ observationId: ids[0] }];
  const specialties = opinions.map((item) => item.specialty);
  return {
    urgency: { tier, reasons: ref },
    blocks: [
      {
        kind: "interpretation",
        text: "Специалисты прочли одни и те же подтверждённые значения; ниже — где они сходятся.",
        refs: ref,
      },
    ],
    agreements:
      specialties.length > 1
        ? [
            {
              topic: "Срочность визита",
              verdict: "differ",
              specialties,
              why: "Один специалист зовёт в ближайшие недели, другой считает визит плановым.",
            },
          ]
        : [],
  };
}

function physicianOutput(prompt: string): unknown {
  const specialty = /^Specialty: (\w+)$/m.exec(prompt)?.[1];
  if (specialty !== undefined) return specialistOutput(specialty, prompt);
  const ids = [...prompt.matchAll(/"observationId":"([0-9a-f-]{36})"/g)].map((match) => match[1]);
  const ref = ids[0] === undefined ? [] : [{ observationId: ids[0] }];
  if (!prompt.includes('"interpretationReady":true') || ref.length === 0) {
    return {
      urgency: { tier: "none", reasons: [] },
      blocks: [
        { kind: "missing", context: "sex" },
        { kind: "missing", context: "birth_year" },
      ],
    };
  }
  return {
    urgency: { tier: "none", reasons: ref },
    blocks: [
      { kind: "interpretation", text: "Значение A в пределах напечатанного диапазона.", refs: ref },
      {
        kind: "hypothesis",
        name: "Синтетическое состояние A",
        confidence: "low",
        rationale: "Одно значение без динамики.",
        refs: ref,
        confirmWith: "therapist",
        workup: ["Повторить A"],
      },
      { kind: "question", text: "Нужно ли повторять анализ?", refs: ref },
    ],
  };
}

function checkerOutput(prompt: string): unknown {
  const answer = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as { blocks: unknown[] };
  return {
    verdicts: answer.blocks.map((_, blockIndex) => ({
      blockIndex,
      verdict: "supported",
      note: null,
    })),
    urgency: "routine",
  };
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
        const schema = turn.schema as { properties: Record<string, unknown> };
        const output =
          schema.properties.verdicts !== undefined
            ? checkerOutput(turn.prompt)
            : schema.properties.agreements !== undefined
              ? synthesisOutput(turn.prompt)
              : physicianOutput(turn.prompt);
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

export function assistantPath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/assistants/physician`;
}

/** Family, documents, medical profile and the physician assistant over a scripted runtime. */
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
  registerMedicalProfileRoutes(app, family, createMedicalProfileService(database), {
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
