#!/usr/bin/env node
// The fake `codex` executable the e2e run puts on PATH (scripts/run-e2e.mjs). It answers every
// CLI shape Veylta invokes — version/login probes, the app-server model list, `exec` under an
// output schema — with fixed synthetic content, so the suites exercise plumbing, never a model.
// Changing how the API invokes the CLI (flags, schema, output file) means updating this stub.
import { handleExec } from "./fake-codex-exec.mjs";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli 0.147.0\n");
} else if (args[0] === "login" && args[1] === "status") {
  process.stderr.write("Logged in using ChatGPT\n");
} else if (args[0] === "app-server" && args.length === 1) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      if (message.id === 1) {
        process.stdout.write(
          JSON.stringify({ id: 1, result: { appServerVersion: "0.147.0" } }) + "\n",
        );
      } else if (message.id === 2) {
        process.stdout.write(
          JSON.stringify({
            id: 2,
            result: {
              data: [
                {
                  id: "gpt-5.6-sol",
                  displayName: "GPT-5.6 Sol",
                  isDefault: true,
                  defaultReasoningEffort: "medium",
                  supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map(
                    (reasoningEffort) => ({ reasoningEffort }),
                  ),
                  serviceTiers: [{ id: "default" }, { id: "priority" }],
                  upgrade: null,
                },
                {
                  id: "gpt-5.6-luna",
                  displayName: "GPT-5.6 Luna",
                  isDefault: false,
                  defaultReasoningEffort: "medium",
                  supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map(
                    (reasoningEffort) => ({ reasoningEffort }),
                  ),
                  serviceTiers: [{ id: "default" }, { id: "priority" }],
                  upgrade: null,
                },
              ],
            },
          }) + "\n",
        );
      } else if (message.id === 3) {
        process.stdout.write(
          JSON.stringify({
            id: 3,
            result: {
              rateLimits: {
                primary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: 1787056800 },
              },
            },
          }) + "\n",
        );
      }
    }
  });
} else if (args[0] === "app-server" && args[1] === "daemon" && args[2] === "version") {
  process.stdout.write('{"appServerVersion":"0.147.0"}\n');
} else if (args[0] === "app-server" && args[1] === "daemon" && args[2] === "start") {
  process.stdout.write("started\n");
} else if (args[0] === "exec") {
  await handleExec(args);
} else {
  process.exit(2);
}
