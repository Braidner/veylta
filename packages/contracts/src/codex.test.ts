import assert from "node:assert/strict";
import test from "node:test";
import {
  API_REQUEST_OVERHEAD_MS,
  CODEX_EXECS_PER_ASSISTANT_TURN,
  HOME_SETTINGS_CONTRACT_VERSION,
  type HomeSettingsResponse,
  MAX_API_REQUEST_DURATION_MS,
  MAX_CODEX_EXEC_TIMEOUT_MS,
} from "./index.js";

test("home settings expose only Codex-advertised choices and bounded usage", () => {
  const response = {
    contractVersion: HOME_SETTINGS_CONTRACT_VERSION,
    codex: {
      installed: true,
      authenticated: true,
      authenticationMode: "chatgpt",
      authenticationOwner: "codex_cli",
      daemonRunning: true,
      cliVersion: "codex-cli 0.147.0",
      runtimeVersion: "0.147.0",
      preference: {
        modelId: "gpt-5.6-sol",
        documentModelId: null,
        reasoningEffort: "medium",
        documentReasoningEffort: "medium",
        assistantReasoningEffort: "high",
        serviceTier: "standard",
      },
      models: [
        {
          id: "gpt-5.6-sol",
          displayName: "GPT-5.6-Sol",
          isDefault: true,
          defaultReasoningEffort: "low",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
          supportsFastMode: true,
          upgradeModelId: null,
        },
      ],
      usageLimits: [
        {
          name: "Codex",
          usedPercent: 65,
          remainingPercent: 35,
          windowDurationMinutes: 10_080,
          resetsAt: "2026-08-20T14:41:53.000Z",
        },
      ],
      experimental: true,
    },
    storage: {
      driver: "local",
      rootPath: "/srv/veylta",
      state: "stable",
      targetRootPath: null,
      generation: 1,
      relocationSupported: true,
      lastFailureCode: null,
    },
    accounts: [],
  } as const satisfies HomeSettingsResponse;

  assert.equal(response.codex.preference.assistantReasoningEffort, "high");
  assert.equal(response.codex.usageLimits[0].remainingPercent, 35);
});

test("one Codex exec may be given a quarter of an hour at the operator's ceiling", () => {
  assert.equal(MAX_CODEX_EXEC_TIMEOUT_MS, 900_000);
  assert.equal(CODEX_EXECS_PER_ASSISTANT_TURN, 2);
  assert.equal(API_REQUEST_OVERHEAD_MS, 60_000);
});

test("the request ceiling admits a whole assistant turn, answer and checker both", () => {
  assert.equal(
    MAX_API_REQUEST_DURATION_MS,
    MAX_CODEX_EXEC_TIMEOUT_MS * CODEX_EXECS_PER_ASSISTANT_TURN + API_REQUEST_OVERHEAD_MS,
  );
  // A hop that admits one budget and not the turn around it gives up mid-turn, and the API's
  // finished, persisted answer reaches the person as a connection failure instead.
  assert.ok(MAX_API_REQUEST_DURATION_MS > MAX_CODEX_EXEC_TIMEOUT_MS);
  // Next's own default. The bound exists because that default is far below one turn.
  assert.ok(MAX_API_REQUEST_DURATION_MS > 30_000);
});
