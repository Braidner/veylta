import type { DocumentIntelligenceResult, SyntheticDocumentContentType } from "@veylta/contracts";
import type { DocumentPageImage } from "./document-images.js";
import type {
  ExtractedPageText,
  ParsedDocumentPage,
  StrictLabExtractionFact,
} from "./synthetic-lab-parser.js";

export interface DocumentIntelligenceInput {
  readonly contentType: SyntheticDocumentContentType;
  /** Text-layer pages. Empty when the source reaches the model as images instead. */
  readonly pages: readonly ExtractedPageText[];
  /**
   * Bounded page images for a source without a text layer. The model transcribes them and
   * every fragment is bound to that transcription, so provenance still names a page.
   */
  readonly images?: readonly DocumentPageImage[];
  /**
   * The household's analyte catalog. It travels with every request so the model links a
   * measurement to a code the family already uses; a code outside it is refused.
   */
  readonly analyteCatalog?: readonly AnalyteCatalogEntry[];
}

export interface AnalyteCatalogEntry {
  readonly code: string;
  readonly displayName: string;
  readonly unit: string;
  readonly aliases: readonly string[];
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
