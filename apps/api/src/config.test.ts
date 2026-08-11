import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

function withEnvironment(
  overrides: Record<string, string | undefined>,
  operation: () => void,
): void {
  const original = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(overrides)) {
    original.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    operation();
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("demo registration cannot bind to a non-loopback API host", () => {
  withEnvironment(
    {
      API_HOST: "0.0.0.0",
      DEMO_REGISTRATION_ENABLED: "true",
      WEB_ORIGIN: "http://127.0.0.1:4300",
    },
    () => {
      assert.throws(() => loadConfig(), /DEMO_REGISTRATION_ENABLED requires a loopback API_HOST/);
    },
  );
});

test("demo registration is disabled unless it is explicitly configured", () => {
  withEnvironment(
    {
      API_HOST: "0.0.0.0",
      DEMO_REGISTRATION_ENABLED: undefined,
      WEB_ORIGIN: "https://family-health.invalid",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.demoRegistrationEnabled, false);
      assert.equal(config.webOrigin, "https://family-health.invalid");
    },
  );
});
