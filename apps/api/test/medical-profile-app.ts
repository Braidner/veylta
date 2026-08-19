import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DemoRegistrationResponse } from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerProfileHandleRoutes } from "../src/family/profile-handle-routes.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import { createMedicalProfileService } from "../src/medical-profile/medical-profile-service.js";
import { registerMedicalProfileRoutes } from "../src/medical-profile/routes.js";

export const webOrigin = "http://127.0.0.1:4300";

export interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
  userId: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const value = response.headers["set-cookie"];
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") throw new Error("Expected session cookie");
  return header.split(";", 1)[0] ?? "";
}

export async function register(app: FastifyInstance, label: string): Promise<Identity> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/demo/registrations",
    headers: { origin: webOrigin },
    payload: {
      displayName: `${label} owner`,
      familyName: `${label} family`,
      profileName: `${label} profile`,
    },
  });
  assert.equal(response.statusCode, 201);
  const cookie = cookieFrom(response);
  const session = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie } });
  return { body: response.json(), cookie, userId: session.json().user.id as string };
}

export function medicalProfilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/medical-profile`;
}

/** A migrated temp database and an app with family + medical-profile routes; call `close()` when done. */
export async function startMedicalProfileApp(): Promise<{
  app: FastifyInstance;
  database: Database;
  close: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "veylta-medical-profile-"));
  const database = createDatabase(join(root, "test.sqlite"));
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
  registerProfileHandleRoutes(app, family, database, { allowedMutationOrigins: [webOrigin] });
  registerMedicalProfileRoutes(app, family, createMedicalProfileService(database), {
    allowedMutationOrigins: [webOrigin],
  });
  return {
    app,
    database,
    close: async () => {
      await app.close();
      await database.close();
      await rm(root, { force: true, recursive: true });
    },
  };
}
