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
      WEB_ORIGIN: "https://veylta.invalid",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.demoRegistrationEnabled, false);
      assert.equal(config.webOrigin, "https://veylta.invalid");
    },
  );
});

test("the configured PDF limit cannot exceed the contract and database boundary", () => {
  withEnvironment({ MAX_PDF_BYTES: "5242881" }, () => {
    assert.throws(() => loadConfig(), /MAX_PDF_BYTES must not exceed 5242880/);
  });
  withEnvironment({ MAX_PDF_BYTES: undefined }, () => {
    assert.equal(loadConfig().maxPdfBytes, 5 * 1024 * 1024);
  });
});

test("processing worker timings have safe defaults and reject non-positive values", () => {
  withEnvironment(
    {
      PROCESSING_LEASE_DURATION_MS: undefined,
      PROCESSING_POLL_INTERVAL_MS: undefined,
      PROCESSING_RETRY_DELAY_MS: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.processingLeaseDurationMs, 60_000);
      assert.equal(config.processingPollIntervalMs, 500);
      assert.equal(config.processingRetryDelayMs, 1_000);
    },
  );

  withEnvironment({ PROCESSING_POLL_INTERVAL_MS: "0" }, () => {
    assert.throws(() => loadConfig(), /PROCESSING_POLL_INTERVAL_MS must be a positive integer/);
  });
  withEnvironment({ PROCESSING_LEASE_DURATION_MS: "-1" }, () => {
    assert.throws(() => loadConfig(), /PROCESSING_LEASE_DURATION_MS must be a positive integer/);
  });
  withEnvironment({ PROCESSING_RETRY_DELAY_MS: "100ms" }, () => {
    assert.throws(() => loadConfig(), /PROCESSING_RETRY_DELAY_MS must be a positive integer/);
  });
});

test("a relative object storage override stays rooted in the workspace", () => {
  withEnvironment({ OBJECT_STORAGE_ROOT: ".local/test-storage" }, () => {
    const root = loadConfig().objectStorageRoot;
    assert.equal(root.endsWith("/.local/test-storage"), true);
    assert.notEqual(root, ".local/test-storage");
    assert.equal(root.startsWith("/"), true);
  });
});

test("runtime configuration rejects an in-memory database", () => {
  withEnvironment({ DATABASE_PATH: ":memory:" }, () => {
    assert.throws(() => loadConfig(), /DATABASE_PATH must point to a persistent SQLite file/);
  });
});

test("a relative database path stays rooted in the workspace", () => {
  withEnvironment({ DATABASE_PATH: ".local/test.sqlite" }, () => {
    const path = loadConfig().databasePath;
    assert.equal(path.endsWith("/.local/test.sqlite"), true);
    assert.equal(path.startsWith("/"), true);
  });
});
