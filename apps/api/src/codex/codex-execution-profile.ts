import {
  CODEX_REASONING_EFFORTS,
  CODEX_SERVICE_TIERS,
  type CodexExecutionPreference,
} from "@veylta/contracts";

const modelPattern = /^[a-z0-9][a-z0-9._-]{1,79}$/i;
const reasoningEfforts = new Set<string>(CODEX_REASONING_EFFORTS);
const serviceTiers = new Set<string>(CODEX_SERVICE_TIERS);

export type CodexExecutionProfileResolver = () => Promise<CodexExecutionPreference>;

export function requireCodexExecutionPreference(value: {
  modelId: string;
  reasoningEffort: string;
  serviceTier: string;
}): CodexExecutionPreference {
  if (
    !modelPattern.test(value.modelId) ||
    !reasoningEfforts.has(value.reasoningEffort) ||
    !serviceTiers.has(value.serviceTier)
  ) {
    throw new Error("Codex execution preference is invalid");
  }
  return value as CodexExecutionPreference;
}

export function codexExecutionArguments(profile: CodexExecutionPreference): readonly string[] {
  const preference = requireCodexExecutionPreference(profile);
  return [
    "--model",
    preference.modelId,
    "-c",
    `model_reasoning_effort=${JSON.stringify(preference.reasoningEffort)}`,
    ...(preference.serviceTier === "fast"
      ? ["-c", 'service_tier="fast"', "--enable", "fast_mode"]
      : []),
  ];
}
