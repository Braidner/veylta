import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";
import { withEnvironment } from "../test-support/with-environment.js";

test("Codex execution has one explicit default profile and bounded timeouts", () => {
  withEnvironment(
    Object.fromEntries(
      [
        "CODEX_MODEL",
        "CODEX_REASONING_EFFORT",
        "CODEX_DOCUMENT_REASONING_EFFORT",
        "CODEX_ASSISTANT_REASONING_EFFORT",
        "CODEX_SERVICE_TIER",
        "CODEX_CARE_PLAN_TIMEOUT_MS",
        "CODEX_DOCUMENT_TIMEOUT_MS",
        "CODEX_DOCUMENT_AGENT_TIMEOUT_MS",
        "CODEX_ASSISTANT_TIMEOUT_MS",
      ].map((name) => [name, undefined]),
    ),
    () => {
      const config = loadConfig();
      // Extraction defaults lower than dialogue (transcription under a strict schema); the
      // assistants default higher (a second opinion is reasoning over evidence).
      assert.deepEqual(config.codexDefaultPreference, {
        modelId: "gpt-5.6-sol",
        documentModelId: null,
        reasoningEffort: "medium",
        documentReasoningEffort: "low",
        assistantReasoningEffort: "high",
        serviceTier: "standard",
      });
      assert.equal(config.codexAssistantTimeoutMs, 300_000);
      assert.equal(config.codexCarePlanTimeoutMs, 120_000);
      assert.equal(config.codexDocumentTimeoutMs, 600_000);
      assert.equal(config.codexDocumentAgentTimeoutMs, 120_000);
    },
  );
  withEnvironment({ CODEX_MODEL: "bad model" }, () => {
    assert.throws(() => loadConfig(), /CODEX_MODEL/);
  });
  withEnvironment({ CODEX_REASONING_EFFORT: "extreme" }, () => {
    assert.throws(() => loadConfig(), /preference/i);
  });
  withEnvironment({ CODEX_SERVICE_TIER: "turbo" }, () => {
    assert.throws(() => loadConfig(), /preference/i);
  });
  withEnvironment({ CODEX_CARE_PLAN_TIMEOUT_MS: "600001" }, () => {
    assert.throws(() => loadConfig(), /CODEX_CARE_PLAN_TIMEOUT_MS must not exceed 600000/);
  });
  withEnvironment({ CODEX_DOCUMENT_AGENT_TIMEOUT_MS: "600001" }, () => {
    assert.throws(() => loadConfig(), /CODEX_DOCUMENT_AGENT_TIMEOUT_MS must not exceed 600000/);
  });
});
