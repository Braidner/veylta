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
  documentModelId?: string | null;
  reasoningEffort: string;
  documentReasoningEffort: string;
  assistantReasoningEffort: string;
  serviceTier: string;
}): CodexExecutionPreference {
  const documentModelId = value.documentModelId ?? null;
  if (
    !modelPattern.test(value.modelId) ||
    (documentModelId !== null && !modelPattern.test(documentModelId)) ||
    !reasoningEfforts.has(value.reasoningEffort) ||
    !reasoningEfforts.has(value.documentReasoningEffort) ||
    !reasoningEfforts.has(value.assistantReasoningEffort) ||
    !serviceTiers.has(value.serviceTier)
  ) {
    throw new Error("Codex execution preference is invalid");
  }
  return { ...value, documentModelId } as CodexExecutionPreference;
}

/**
 * The profile a document-analysis run executes with: the document model (or the shared one)
 * and the document effort in the seats the CLI reads. Dialogues and care-plan proposals use
 * the preference as-is.
 */
export function documentExecutionProfile(
  preference: CodexExecutionPreference,
): CodexExecutionPreference {
  return {
    ...preference,
    modelId: preference.documentModelId ?? preference.modelId,
    reasoningEffort: preference.documentReasoningEffort,
  };
}

/** The assistants and their checker reason over the dialogue model at their own effort. */
export function assistantExecutionProfile(
  preference: CodexExecutionPreference,
): CodexExecutionPreference {
  return { ...preference, reasoningEffort: preference.assistantReasoningEffort };
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
