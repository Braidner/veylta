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
  /**
   * Effort for the assistants («ИИ-врач» and its checker run). A second opinion is reasoning
   * over evidence, so it defaults high and is kept apart from the fast document effort.
   */
  readonly assistantReasoningEffort: CodexReasoningEffort;
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

// How long the CLI may run, and so how long one API request may take — the one place every hop
// in front of the API reads it from. The API alone decides when work has run too long:
// `apps/api/src/config.ts` bounds each Codex budget and `codex/codex-cli-executor.ts` kills the
// child on it. A hop in front of the API — today the Next rewrite `/health-api/:path*`, which
// abandons an upstream request after 30 s unless told otherwise — must never be the first to
// give up, or the API finishes the work and persists it while the browser is told the
// connection failed.

/**
 * The longest a single `codex exec` may run: the ceiling `CODEX_ASSISTANT_TIMEOUT_MS` is bounded
 * by, and the largest of the API's Codex budgets. Its default is a third of it.
 */
export const MAX_CODEX_EXEC_TIMEOUT_MS = 900_000;
/**
 * One assistant turn is two of those budgets in sequence: the answer, then the independent run
 * that refutes it. Everything shorter — a care-plan proposal, a document agent turn — is one.
 */
export const CODEX_EXECS_PER_ASSISTANT_TURN = 2;
/** Veylta's own work around them: loading the evidence, verifying every block, persisting. */
export const API_REQUEST_OVERHEAD_MS = 60_000;
/**
 * The ceiling every hop in front of the API must admit. It covers one assistant turn at the
 * largest budget an operator may configure, and so every shorter request; a normal turn is far
 * below it.
 *
 * It does **not** cover a консилиум. That runs a persona and a checker for each of up to
 * `MAX_CONSILIUM_SPECIALISTS` invited specialties and then a synthesis with its own checker —
 * a dozen execs, four budgets deep, all contending for one local CLI. No socket timeout is the
 * right bound for that: it needs a turn that becomes a job the room polls, the way document
 * processing already works with `processing_jobs`. Until then a консилиум can still outlive
 * this ceiling and reach the browser as a failure it is not.
 */
export const MAX_API_REQUEST_DURATION_MS =
  MAX_CODEX_EXEC_TIMEOUT_MS * CODEX_EXECS_PER_ASSISTANT_TURN + API_REQUEST_OVERHEAD_MS;
