import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.js";

test("liveness does not depend on PostgreSQL", async () => {
  const app = buildApp({
    logger: false,
    readiness: { check: async () => Promise.reject(new Error("database unavailable")) },
  });

  const response = await app.inject({ method: "GET", url: "/healthz" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", service: "api", version: "v1" });
  await app.close();
});

test("readiness fails closed when PostgreSQL is unavailable", async () => {
  const app = buildApp({
    logger: false,
    readiness: { check: async () => Promise.reject(new Error("database unavailable")) },
  });

  const response = await app.inject({ method: "GET", url: "/readyz" });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().status, "unavailable");
  await app.close();
});
