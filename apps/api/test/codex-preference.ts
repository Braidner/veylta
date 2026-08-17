import type { CodexExecutionPreference } from "@veylta/contracts";

/** The household's Codex preference as the synthetic tests assume it, with overrides. */
export function syntheticPreference(
  overrides: Partial<CodexExecutionPreference> = {},
): CodexExecutionPreference {
  return {
    modelId: "gpt-5.6-sol",
    documentModelId: null,
    reasoningEffort: "medium",
    documentReasoningEffort: "medium",
    assistantReasoningEffort: "high",
    serviceTier: "standard",
    ...overrides,
  };
}
