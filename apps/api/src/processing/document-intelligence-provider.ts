import type { DocumentIntelligenceResult, SyntheticDocumentContentType } from "@veylta/contracts";
import type {
  ExtractedPageText,
  ParsedDocumentPage,
  StrictLabExtractionFact,
} from "./synthetic-lab-parser.js";

export interface DocumentIntelligenceInput {
  readonly contentType: SyntheticDocumentContentType;
  readonly pages: readonly ExtractedPageText[];
}

export interface DocumentIntelligenceOutput {
  readonly pages: readonly ParsedDocumentPage[];
  readonly extraction: {
    readonly schemaVersion: "lab-extraction/v1";
    readonly extractorVersion: string;
    readonly items: readonly StrictLabExtractionFact[];
  };
  readonly intelligence: DocumentIntelligenceResult;
}

/** Explicit alias for consumers that want to state the v2 provider guarantee. */
export type DocumentIntelligenceV2Output = DocumentIntelligenceOutput;

/** Provider-neutral semantic boundary; storage and byte transport stay outside it. */
/**
 * One Codex round trip, kept so the owner can see what was sent and what came back when a
 * run fails. Bounded copies only; the provider truncates before it reaches storage.
 */
export interface DocumentIntelligenceExchange {
  readonly requestText: string;
  readonly responseText: string;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly modelId: string;
  readonly runtimeVersion: string | null;
  readonly pageCount: number;
  readonly durationMs: number;
}

export interface DocumentIntelligenceProvider {
  analyze(
    input: DocumentIntelligenceInput,
  ): Promise<DocumentIntelligenceOutput & { exchange?: DocumentIntelligenceExchange }>;
}
