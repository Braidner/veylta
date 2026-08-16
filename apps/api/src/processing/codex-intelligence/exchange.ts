import type { DocumentIntelligenceExchange } from "../document-intelligence-provider.js";
import { limits } from "./constants.js";
import { CodexDocumentIntelligenceError } from "./errors.js";

function boundedExchangeText(value: string): string {
  return value.length <= limits.exchangeCharacters
    ? value
    : `${value.slice(0, limits.exchangeCharacters - 1)}…`;
}

/**
 * What one attempt sent and received, for the run journal. The journal is the one diagnostic
 * surface that may carry document content, so the texts are bounded and nothing else copies them.
 */
export function exchangeOf(input: {
  readonly request: string;
  readonly response: string;
  readonly modelId: string;
  readonly runtimeVersion: string | null;
  readonly pageCount: number;
  readonly startedAt: number;
}): DocumentIntelligenceExchange {
  return {
    requestText: boundedExchangeText(input.request),
    responseText: boundedExchangeText(input.response),
    requestBytes: Buffer.byteLength(input.request, "utf8"),
    responseBytes: Buffer.byteLength(input.response, "utf8"),
    modelId: input.modelId,
    runtimeVersion: input.runtimeVersion,
    pageCount: input.pageCount,
    durationMs: Math.max(0, Date.now() - input.startedAt),
  };
}

/** Attaches the attempt to a refusal so the journal can show why the answer was refused. */
export function withExchange(error: unknown, exchange: DocumentIntelligenceExchange): unknown {
  if (error instanceof CodexDocumentIntelligenceError) error.exchange = exchange;
  return error;
}
