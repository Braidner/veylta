import {
  CODEX_REASONING_EFFORTS,
  type CodexExecutionPreference,
  type CodexReasoningEffort,
} from "@veylta/contracts";
import { requireCodexExecutionPreference } from "./codex-execution-profile.js";

/** What the CLI runs with before the household picks anything on the settings page. */
function codexModel(): string {
  const value = process.env.CODEX_MODEL ?? "gpt-5.6-sol";
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(value)) {
    throw new Error("CODEX_MODEL must be a canonical Codex model id");
  }
  return value;
}

export function codexAssistantReasoningEffort(): CodexReasoningEffort {
  // A second opinion is reasoning, not transcription: the assistants default to high effort.
  const value = process.env.CODEX_ASSISTANT_REASONING_EFFORT ?? "high";
  if (!(CODEX_REASONING_EFFORTS as readonly string[]).includes(value)) {
    throw new Error("CODEX_ASSISTANT_REASONING_EFFORT must be a Codex reasoning effort");
  }
  return value as CodexReasoningEffort;
}

export function codexDefaultPreference(): CodexExecutionPreference {
  return requireCodexExecutionPreference({
    modelId: codexModel(),
    documentModelId: null,
    reasoningEffort: process.env.CODEX_REASONING_EFFORT ?? "medium",
    // Extraction is transcription under a strict schema; low effort is several times faster.
    documentReasoningEffort: process.env.CODEX_DOCUMENT_REASONING_EFFORT ?? "low",
    serviceTier: process.env.CODEX_SERVICE_TIER ?? "standard",
  });
}
