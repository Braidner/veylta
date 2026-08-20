import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DemoRegistrationResponse } from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { createFamilyService, type FamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";

export const webOrigin = "http://127.0.0.1:4300";

export interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
  userId: string;
}

/** The full Set-Cookie header, for tests that assert cookie attributes. */
export function setCookieHeader(response: LightMyRequestResponse): string {
  const value = response.headers["set-cookie"];
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") throw new Error("Expected a Set-Cookie header");
  return header;
}

/** The session cookie pair (`name=value`) from a response that set one. */
export function cookieFrom(response: LightMyRequestResponse): string {
  const pair = setCookieHeader(response).split(";", 1)[0];
  if (pair === undefined || pair === "") throw new Error("Expected a cookie pair");
  return pair;
}

/** buildApp + a family service wired for tests; callers register further routes on `app`. */
export function createFamilyApp(
  database: Database,
  options: { demoRegistrationEnabled?: boolean } = {},
): { app: FastifyInstance; familyService: FamilyService } {
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  const familyService = createFamilyService(database, {
    cookieName: "veylta_session",
    secureCookie: false,
    sessionTtlSeconds: 3_600,
  });
  registerFamilyRoutes(app, familyService, {
    allowedMutationOrigins: [webOrigin],
    demoRegistrationEnabled: options.demoRegistrationEnabled ?? true,
  });
  return { app, familyService };
}

/** A migrated temp database under its own temp root; `close()` removes both. */
export async function createTempDatabase(): Promise<{
  database: Database;
  root: string;
  close: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "veylta-test-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
  } catch (error) {
    await database.close();
    await rm(root, { force: true, recursive: true });
    throw error;
  }
  return {
    database,
    root,
    close: async () => {
      await database.close();
      await rm(root, { force: true, recursive: true });
    },
  };
}

/** A migrated temp database and a family-routes app; call `close()` when done. */
export async function createFamilyTestContext(
  options: { demoRegistrationEnabled?: boolean } = {},
): Promise<{ app: FastifyInstance; database: Database; close: () => Promise<void> }> {
  const temp = await createTempDatabase();
  const { app } = createFamilyApp(temp.database, options);
  return {
    app,
    database: temp.database,
    close: async () => {
      await app.close();
      await temp.close();
    },
  };
}

/** The raw demo-registration response, for tests that assert failures or headers. */
export async function demoRegistration(
  app: FastifyInstance,
  names: { displayName: string; familyName: string; profileName: string },
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "POST",
    url: "/v1/demo/registrations",
    headers: { origin: webOrigin },
    payload: names,
  });
}

/** One registered owner: `<label> owner` in `<label> family` with `<label> profile`. */
export async function register(app: FastifyInstance, label: string): Promise<Identity> {
  const response = await demoRegistration(app, {
    displayName: `${label} owner`,
    familyName: `${label} family`,
    profileName: `${label} profile`,
  });
  assert.equal(response.statusCode, 201);
  const cookie = cookieFrom(response);
  const session = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie } });
  assert.equal(session.statusCode, 200);
  return { body: response.json(), cookie, userId: session.json().user.id as string };
}
