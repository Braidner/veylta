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

test("the configured document limit cannot exceed the contract and database boundary", () => {
  withEnvironment({ MAX_DOCUMENT_BYTES: "5242881" }, () => {
    assert.throws(() => loadConfig(), /MAX_DOCUMENT_BYTES must not exceed 5242880/);
  });
  withEnvironment({ MAX_DOCUMENT_BYTES: undefined }, () => {
    assert.equal(loadConfig().maxDocumentBytes, 5 * 1024 * 1024);
  });
});

test("processing worker timings have safe defaults and reject non-positive values", () => {
  withEnvironment(
    {
      PROCESSING_LEASE_DURATION_MS: undefined,
      PROCESSING_POLL_INTERVAL_MS: undefined,
      PROCESSING_RETRY_DELAY_MS: undefined,
      CODEX_DOCUMENT_TIMEOUT_MS: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.processingLeaseDurationMs, 360_000);
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
  withEnvironment(
    { CODEX_DOCUMENT_TIMEOUT_MS: "180000", PROCESSING_LEASE_DURATION_MS: "200000" },
    () => {
      assert.throws(() => loadConfig(), /must exceed CODEX_DOCUMENT_TIMEOUT_MS/);
    },
  );
  withEnvironment({ PROCESSING_RETRY_DELAY_MS: "100ms" }, () => {
    assert.throws(() => loadConfig(), /PROCESSING_RETRY_DELAY_MS must be a positive integer/);
  });
});

test("Codex care-plan runtime has an explicit bounded model and timeout", () => {
  withEnvironment(
    { CODEX_CARE_PLAN_MODEL: undefined, CODEX_CARE_PLAN_TIMEOUT_MS: undefined },
    () => {
      const config = loadConfig();
      assert.equal(config.codexCarePlanModel, "gpt-5.4-mini");
      assert.equal(config.codexCarePlanTimeoutMs, 120_000);
    },
  );
  withEnvironment({ CODEX_CARE_PLAN_MODEL: "bad model" }, () => {
    assert.throws(() => loadConfig(), /CODEX_CARE_PLAN_MODEL/);
  });
  withEnvironment({ CODEX_CARE_PLAN_TIMEOUT_MS: "600001" }, () => {
    assert.throws(() => loadConfig(), /CODEX_CARE_PLAN_TIMEOUT_MS must not exceed 600000/);
  });
});

test("Codex document intelligence has an explicit model and bounded timeout", () => {
  withEnvironment({ CODEX_DOCUMENT_MODEL: undefined, CODEX_DOCUMENT_TIMEOUT_MS: undefined }, () => {
    const config = loadConfig();
    assert.equal(config.codexDocumentModel, "gpt-5.4-mini");
    assert.equal(config.codexDocumentTimeoutMs, 300_000);
  });
  withEnvironment({ CODEX_DOCUMENT_MODEL: "bad model" }, () => {
    assert.throws(() => loadConfig(), /CODEX_DOCUMENT_MODEL/);
  });
});

test("Codex document dialogue has an explicit bounded model and timeout", () => {
  withEnvironment(
    { CODEX_DOCUMENT_AGENT_MODEL: undefined, CODEX_DOCUMENT_AGENT_TIMEOUT_MS: undefined },
    () => {
      const config = loadConfig();
      assert.equal(config.codexDocumentAgentModel, "gpt-5.4-mini");
      assert.equal(config.codexDocumentAgentTimeoutMs, 120_000);
    },
  );
  withEnvironment({ CODEX_DOCUMENT_AGENT_MODEL: "bad model" }, () => {
    assert.throws(() => loadConfig(), /CODEX_DOCUMENT_AGENT_MODEL/);
  });
  withEnvironment({ CODEX_DOCUMENT_AGENT_TIMEOUT_MS: "600001" }, () => {
    assert.throws(() => loadConfig(), /CODEX_DOCUMENT_AGENT_TIMEOUT_MS must not exceed 600000/);
  });
});

test("the default local object storage stays rooted in the workspace", () => {
  withEnvironment(
    { OBJECT_STORAGE_DRIVER: undefined, OBJECT_STORAGE_ROOT: ".local/test-storage" },
    () => {
      const storage = loadConfig().objectStorage;
      assert.equal(storage.mode, "local");
      if (storage.mode !== "local") throw new Error("Expected local storage");
      const root = storage.rootPath;
      assert.equal(root.endsWith("/.local/test-storage"), true);
      assert.notEqual(root, ".local/test-storage");
      assert.equal(root.startsWith("/"), true);
    },
  );
});

test("S3 storage is explicit, encrypted, and configured without application credentials", () => {
  withEnvironment(
    {
      OBJECT_STORAGE_DRIVER: "s3",
      S3_BUCKET: "veylta-synthetic-bucket",
      S3_REGION: "eu-west-1",
      S3_PREFIX: "veylta",
      S3_SERVER_SIDE_ENCRYPTION: "aws:kms",
      S3_KMS_KEY_ID: "arn:aws:kms:eu-west-1:000000000000:key/test",
      S3_ENDPOINT: "https://objects.example.test",
      S3_FORCE_PATH_STYLE: "true",
    },
    () => {
      const storage = loadConfig().objectStorage;
      assert.deepEqual(storage, {
        mode: "s3",
        bucket: "veylta-synthetic-bucket",
        region: "eu-west-1",
        prefix: "veylta",
        endpoint: "https://objects.example.test",
        forcePathStyle: true,
        encryption: { mode: "aws:kms", keyId: "arn:aws:kms:eu-west-1:000000000000:key/test" },
      });
    },
  );
});

test("S3 storage fails closed for missing encryption, invalid KMS options, or non-HTTPS endpoint", () => {
  const base = {
    OBJECT_STORAGE_DRIVER: "s3",
    S3_BUCKET: "veylta-synthetic-bucket",
    S3_REGION: "eu-west-1",
    S3_PREFIX: "veylta",
  };
  withEnvironment(base, () => {
    assert.throws(() => loadConfig(), /S3_SERVER_SIDE_ENCRYPTION is required/);
  });
  withEnvironment({ ...base, S3_SERVER_SIDE_ENCRYPTION: "AES256", S3_KMS_KEY_ID: "key" }, () => {
    assert.throws(() => loadConfig(), /S3_KMS_KEY_ID requires/);
  });
  withEnvironment(
    { ...base, S3_SERVER_SIDE_ENCRYPTION: "AES256", S3_ENDPOINT: "http://objects.example.test" },
    () => {
      assert.throws(() => loadConfig(), /S3_ENDPOINT must be an HTTPS origin/);
    },
  );
  withEnvironment(
    { ...base, S3_SERVER_SIDE_ENCRYPTION: "AES256", S3_ENDPOINT: "not a url" },
    () => {
      assert.throws(() => loadConfig(), /S3_ENDPOINT must be an HTTPS origin/);
    },
  );
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
