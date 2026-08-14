import type { DocumentIntelligenceSummary, SyntheticDocumentContentType } from "@veylta/contracts";
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
  readonly intelligence: DocumentIntelligenceSummary;
}

/** Provider-neutral semantic boundary; storage and byte transport stay outside it. */
export interface DocumentIntelligenceProvider {
  analyze(input: DocumentIntelligenceInput): Promise<DocumentIntelligenceOutput>;
}
