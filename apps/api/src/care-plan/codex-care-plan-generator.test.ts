import assert from "node:assert/strict";
import test from "node:test";
import { createCodexCarePlanGenerator } from "./codex-care-plan-generator.js";

test("Codex proposal generation uses a closed schema and no local tools", async () => {
  const calls: Array<{ arguments_: readonly string[]; input: string }> = [];
  const generator = createCodexCarePlanGenerator(
    { modelId: "gpt-5.4-mini", timeoutMs: 10_000 },
    async (arguments_, input, files) => {
      calls.push({ arguments_, input });
      await files.writeOutput(
        JSON.stringify({
          items: [
            {
              category: "laboratory",
              sourceObservationIndex: 0,
              missingContext: ["sample_date"],
            },
          ],
        }),
      );
      return { stdout: "", stderr: "", runtimeVersion: "codex-cli 0.147.0" };
    },
  );

  const result = await generator.generate({
    healthSummary: {
      id: "00000000-0000-4000-8000-000000000001",
      version: 2,
      missingData: ["sample_date"],
    },
    evidence: [
      {
        index: 0,
        observationId: "00000000-0000-4000-8000-000000000002",
        sourceName: "Синтетический аналит A",
        sourceValue: "7.0",
        sourceUnit: "ед.",
        canonicalCode: "synthetic-analyte-a",
        sampledAt: null,
        resultedAt: null,
        laboratory: null,
      },
    ],
  });

  assert.deepEqual(result, {
    modelId: "gpt-5.4-mini",
    runtimeVersion: "codex-cli 0.147.0",
    items: [
      {
        category: "laboratory",
        sourceObservationIndex: 0,
        missingContext: ["sample_date"],
      },
    ],
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.arguments_.includes("--ephemeral"));
  assert.ok(calls[0]?.arguments_.includes("--ignore-user-config"));
  assert.ok(calls[0]?.arguments_.includes("--ignore-rules"));
  assert.ok(calls[0]?.arguments_.includes("shell_tool"));
  assert.doesNotMatch(calls[0]?.input ?? "", /sourceFragment|documentId|filename/i);
});

test("Codex proposal generation rejects duplicate lanes and unbound evidence", async () => {
  const generator = createCodexCarePlanGenerator(
    { modelId: "gpt-5.4-mini", timeoutMs: 10_000 },
    async (_arguments, _input, files) => {
      await files.writeOutput(
        JSON.stringify({
          items: [
            { category: "activity", sourceObservationIndex: 9, missingContext: [] },
            { category: "activity", sourceObservationIndex: null, missingContext: [] },
          ],
        }),
      );
      return { stdout: "", stderr: "", runtimeVersion: "codex-cli 0.147.0" };
    },
  );

  await assert.rejects(
    generator.generate({
      healthSummary: {
        id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        missingData: [],
      },
      evidence: [],
    }),
    /invalid/i,
  );
});
