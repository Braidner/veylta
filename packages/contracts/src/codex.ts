/** How the household's Codex CLI is asked to run: model, effort and tier per kind of work. */
export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const CODEX_SERVICE_TIERS = ["standard", "fast"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export type CodexServiceTier = (typeof CODEX_SERVICE_TIERS)[number];

export interface CodexExecutionPreference {
  readonly modelId: string;
  /**
   * Model for document analysis, or null for the same model as dialogues. A separate model
   * has its own usage window in Codex, so extraction need not compete with conversations.
   */
  readonly documentModelId: string | null;
  /** Effort for dialogues and care-plan proposals — work that benefits from reasoning. */
  readonly reasoningEffort: CodexReasoningEffort;
  /**
   * Effort for document analysis. Extraction is transcription under a strict schema, so it
   * runs well at a lower effort and several times faster; kept separate so a household can
   * tune the two independently.
   */
  readonly documentReasoningEffort: CodexReasoningEffort;
  readonly serviceTier: CodexServiceTier;
}

export interface CodexModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: CodexReasoningEffort;
  readonly supportedReasoningEfforts: readonly CodexReasoningEffort[];
  readonly supportsFastMode: boolean;
  readonly upgradeModelId: string | null;
}

export interface CodexUsageLimit {
  readonly name: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly windowDurationMinutes: number;
  readonly resetsAt: string;
}
