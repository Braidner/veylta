import assert from "node:assert/strict";
import test from "node:test";
import { createCodexRuntimeProbe } from "./codex-runtime.js";

test("recognizes a ChatGPT subscription when Codex writes login status to stderr", async () => {
  const probe = createCodexRuntimeProbe(
    async (arguments_) => {
      switch (arguments_.join(" ")) {
        case "--version":
          return { stdout: "codex-cli 0.147.0\n", stderr: "" };
        case "login status":
          return { stdout: "", stderr: "Logged in using ChatGPT\n" };
        case "app-server daemon version":
          throw new Error("daemon is not running");
        default:
          throw new Error("unexpected command");
      }
    },
    async () => ({
      models: {
        data: [
          {
            id: "gpt-5.6-sol",
            displayName: "GPT-5.6 Sol",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
            ],
            serviceTiers: [{ id: "default" }, { id: "priority" }],
          },
        ],
      },
      rateLimits: {
        rateLimits: {
          primary: { usedPercent: 65, windowDurationMins: 10_080, resetsAt: 1_787_056_800 },
        },
      },
    }),
  );

  assert.deepEqual(await probe.status(), {
    installed: true,
    authenticated: true,
    authenticationMode: "chatgpt",
    daemonRunning: false,
    cliVersion: "codex-cli 0.147.0",
    runtimeVersion: null,
    models: [
      {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high"],
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
        resetsAt: "2026-08-18T12:40:00.000Z",
      },
    ],
  });
});

test("does not expose unstructured daemon output as a runtime version", async () => {
  const probe = createCodexRuntimeProbe(
    async (arguments_) => {
      if (arguments_[0] === "--version") return { stdout: "codex-cli 0.147.0", stderr: "" };
      if (arguments_[0] === "login") return { stdout: "", stderr: "Logged in using ChatGPT" };
      return { stdout: "", stderr: "socket=/private/path token=secret" };
    },
    async () => ({ models: { data: [{ id: "bad model" }] }, rateLimits: { secret: true } }),
  );

  const status = await probe.status();
  assert.equal(status.authenticated, true);
  assert.equal(status.runtimeVersion, null);
  assert.deepEqual(status.models, []);
  assert.deepEqual(status.usageLimits, []);
});
