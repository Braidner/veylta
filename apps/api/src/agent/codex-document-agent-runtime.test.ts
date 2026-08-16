import assert from "node:assert/strict";
import test from "node:test";
import type { CodexCliExecutor } from "../codex/codex-cli-executor.js";
import { createCodexDocumentAgentRuntime } from "./codex-document-agent-runtime.js";

test("Codex document agent starts and resumes one Russian MCP-only thread", async () => {
  const calls: Array<{ arguments_: readonly string[]; input: string; token: string | undefined }> =
    [];
  const threadId = "01a000f9-3204-7163-ae44-80484165b0db";
  const executor: CodexCliExecutor = async (arguments_, input, files) => {
    calls.push({
      arguments_,
      input,
      token: files.environment?.VEYLTA_DOCUMENT_AGENT_TOKEN,
    });
    await files.writeOutput(JSON.stringify({ message: "Уточните название лаборатории." }));
    return {
      stdout: `${JSON.stringify({ type: "thread.started", thread_id: threadId })}\n`,
      stderr: "",
      runtimeVersion: "codex-cli 0.147.0",
    };
  };
  const runtime = createCodexDocumentAgentRuntime(
    {
      mcpUrl: "http://127.0.0.1:4301/mcp/document-agent",
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.6-sol",
        reasoningEffort: "high",
        documentReasoningEffort: "high",
        serviceTier: "fast",
      }),
      timeoutMs: 30_000,
    },
    executor,
  );

  const started = await runtime.respond({
    threadId: null,
    message: "Проверь документ.",
    capabilityToken: "first-secret-token",
  });
  const resumed = await runtime.respond({
    threadId: started.threadId,
    message: "Лаборатория — Синтетическая лаборатория.",
    capabilityToken: "second-secret-token",
  });

  assert.equal(started.threadId, threadId);
  assert.equal(resumed.threadId, threadId);
  assert.equal(resumed.text, "Уточните название лаборатории.");
  assert.equal(calls[0]?.token, "first-secret-token");
  assert.equal(calls[1]?.token, "second-secret-token");
  assert.equal(calls[0]?.arguments_.includes("--ephemeral"), false);
  assert.ok(calls[0]?.arguments_.includes("--json"));
  assert.ok(calls[0]?.arguments_.includes("gpt-5.6-sol"));
  assert.ok(calls[0]?.arguments_.includes('model_reasoning_effort="high"'));
  assert.ok(calls[0]?.arguments_.includes("fast_mode"));
  assert.ok(calls[0]?.arguments_.includes("shell_tool"));
  assert.ok(calls[0]?.arguments_.some((value) => value.includes("mcp_servers.veylta.url")));
  assert.equal(calls[1]?.arguments_[1], "resume");
  assert.ok(calls[0]?.input.includes("Отвечайте только на русском языке"));
  assert.ok(calls[0]?.input.includes("get_document_context"));
});

test("Codex document agent rejects missing thread provenance and non-Russian empty output", async () => {
  const executor: CodexCliExecutor = async (_arguments_, _input, files) => {
    await files.writeOutput(JSON.stringify({ message: " " }));
    return { stdout: "", stderr: "", runtimeVersion: "codex-cli 0.147.0" };
  };
  const runtime = createCodexDocumentAgentRuntime(
    {
      mcpUrl: "http://127.0.0.1:4301/mcp/document-agent",
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.6-sol",
        reasoningEffort: "medium",
        documentReasoningEffort: "medium",
        serviceTier: "standard",
      }),
      timeoutMs: 30_000,
    },
    executor,
  );

  await assert.rejects(
    () =>
      runtime.respond({
        threadId: null,
        message: "Проверь документ.",
        capabilityToken: "secret-token",
      }),
    /invalid/i,
  );
});
