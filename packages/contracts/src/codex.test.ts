import assert from "node:assert/strict";
import test from "node:test";
import { HOME_SETTINGS_CONTRACT_VERSION, type HomeSettingsResponse } from "./index.js";

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
