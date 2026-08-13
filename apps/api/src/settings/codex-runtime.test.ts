import assert from "node:assert/strict";
import test from "node:test";
import { createCodexRuntimeProbe } from "./codex-runtime.js";

test("recognizes a ChatGPT subscription when Codex writes login status to stderr", async () => {
  const probe = createCodexRuntimeProbe(async (arguments_) => {
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
  });

  assert.deepEqual(await probe.status(), {
    installed: true,
    authenticated: true,
    authenticationMode: "chatgpt",
    daemonRunning: false,
    cliVersion: "codex-cli 0.147.0",
    runtimeVersion: null,
  });
});

test("does not expose unstructured daemon output as a runtime version", async () => {
  const probe = createCodexRuntimeProbe(async (arguments_) => {
    if (arguments_[0] === "--version") return { stdout: "codex-cli 0.147.0", stderr: "" };
    if (arguments_[0] === "login") return { stdout: "", stderr: "Logged in using ChatGPT" };
    return { stdout: "", stderr: "socket=/private/path token=secret" };
  });

  const status = await probe.status();
  assert.equal(status.authenticated, true);
  assert.equal(status.runtimeVersion, null);
});
