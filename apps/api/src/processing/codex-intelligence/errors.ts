import type { ProcessingRejectionReason } from "@veylta/contracts";
import type { DocumentIntelligenceExchange } from "../document-intelligence-provider.js";

export type CodexDocumentIntelligenceErrorCode =
  | "INPUT_INVALID"
  | "OUTPUT_INVALID"
  | "PROVIDER_UNAVAILABLE";

const defaultReasons: Record<CodexDocumentIntelligenceErrorCode, ProcessingRejectionReason> = {
  INPUT_INVALID: "input_invalid",
  OUTPUT_INVALID: "schema_shape",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
};

export class CodexDocumentIntelligenceError extends Error {
  /**
   * The closed reason the server derived while refusing the answer. It is what the run
   * journal shows, so it must stay a code — never a sentence the model produced.
   */
  readonly reason: ProcessingRejectionReason;

  /** The attempt that produced this failure, so the run journal can show it. */
  exchange: DocumentIntelligenceExchange | null = null;

  constructor(
    readonly code: CodexDocumentIntelligenceErrorCode,
    reason?: ProcessingRejectionReason,
  ) {
    super(`Codex document intelligence failed: ${code}`);
    this.name = "CodexDocumentIntelligenceError";
    this.reason = reason ?? defaultReasons[code];
  }
}

/** Refuse the answer, naming the rule it broke. */
export function invalidOutput(reason: ProcessingRejectionReason = "schema_shape"): never {
  throw new CodexDocumentIntelligenceError("OUTPUT_INVALID", reason);
}

export function invalidInput(): never {
  throw new CodexDocumentIntelligenceError("INPUT_INVALID");
}
