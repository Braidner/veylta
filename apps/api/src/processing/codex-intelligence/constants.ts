import { MAX_DOCUMENT_INTELLIGENCE_STRUCTURED_RESULTS } from "@veylta/contracts";

export const CODEX_DOCUMENT_INTELLIGENCE_VERSION = "codex-document-intelligence/v2" as const;
export const CODEX_VISION_EXTRACTION_METHOD = "codex_vision" as const;

/** Bounds of one run: what may go to Codex, what may come back, what one answer may hold. */
export const limits = {
  inputBytes: 1_250_000,
  outputBytes: 256 * 1024,
  pages: 50,
  pageTextCharacters: 250_000,
  totalTextCharacters: 1_000_000,
  facts: 100,
  structuredResults: MAX_DOCUMENT_INTELLIGENCE_STRUCTURED_RESULTS,
  /** Bounded so one oversized answer cannot grow the database without limit. */
  exchangeCharacters: 65_536,
  /** Bounded so a large catalog cannot blow the prompt or the schema. */
  catalogEntries: 400,
  catalogAliases: 6,
  fragmentCharacters: 2_000,
  keyCharacters: 100,
} as const;

export const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const versionPattern = /^[a-z0-9][a-z0-9._/+:-]{0,99}$/;
