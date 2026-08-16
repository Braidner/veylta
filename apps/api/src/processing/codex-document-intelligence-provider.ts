// The Codex-backed DocumentIntelligenceProvider: one run sends a text layer or page images with
// the household catalog and a closed schema, and takes back only what verification kept.
// The parts live in ./codex-intelligence; this file is the public entry every caller imports.
import { createCodexCliExecutor } from "../codex/codex-cli-executor.js";
import type { CodexExecutionProfileResolver } from "../codex/codex-execution-profile.js";
import { documentExtractionPrompt } from "../prompts/document-extraction.prompt.js";
import { CodexAnswerParser } from "./codex-intelligence/answer-parser.js";
import { answerSchemaFor } from "./codex-intelligence/answer-schema.js";
import { runCodexDocumentExtraction } from "./codex-intelligence/codex-run.js";
import { limits } from "./codex-intelligence/constants.js";
import { textLayerPages } from "./codex-intelligence/document-pages.js";
import { invalidInput, invalidOutput } from "./codex-intelligence/errors.js";
import { withExchange } from "./codex-intelligence/exchange.js";
import { boundedCatalog, knownCodes } from "./codex-intelligence/known-analytes.js";
import type { DocumentIntelligenceProvider } from "./document-intelligence-provider.js";

export type { CodexCliExecutor as DocumentIntelligenceExecutor } from "../codex/codex-cli-executor.js";
export {
  CODEX_DOCUMENT_INTELLIGENCE_VERSION,
  CODEX_VISION_EXTRACTION_METHOD,
} from "./codex-intelligence/constants.js";
export {
  CodexDocumentIntelligenceError,
  type CodexDocumentIntelligenceErrorCode,
} from "./codex-intelligence/errors.js";

export function createCodexDocumentIntelligenceProvider(
  options: {
    resolveExecutionProfile: CodexExecutionProfileResolver;
    timeoutMs: number;
  },
  executor = createCodexCliExecutor({
    timeoutMs: options.timeoutMs,
    maximumInputBytes: limits.inputBytes,
    maximumOutputBytes: limits.outputBytes,
  }),
): DocumentIntelligenceProvider {
  if (options.timeoutMs < 1_000) {
    throw new Error("Codex document-intelligence configuration is invalid");
  }
  return {
    async analyze(input) {
      const profile = await options.resolveExecutionProfile();
      const images = input.images ?? [];
      // Exactly one transport per run: a text layer or attached page images, never both.
      if (images.length > limits.pages || (images.length === 0) === (input.pages.length === 0)) {
        invalidInput();
      }
      const pages = images.length > 0 ? [] : textLayerPages(input.pages);
      const catalog = boundedCatalog(input.analyteCatalog ?? []);
      const run = await runCodexDocumentExtraction({
        executor,
        profile,
        request: documentExtractionPrompt({
          contentType: input.contentType,
          pages,
          attachedPages: images,
          knownAnalytes: catalog,
        }),
        schema: answerSchemaFor(images.length > 0 ? "vision" : "text", catalog),
        images,
        pageCount: pages.length + images.length,
        ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
      });
      try {
        if (Buffer.byteLength(run.output, "utf8") > limits.outputBytes) {
          invalidOutput("response_too_large");
        }
        const parser = new CodexAnswerParser({
          textPages: pages,
          images,
          modelId: profile.modelId,
          runtimeVersion: run.runtimeVersion,
          knownCodes: knownCodes(catalog),
        });
        return { ...parser.parse(run.output), exchange: run.exchange };
      } catch (error) {
        throw withExchange(error, run.exchange);
      }
    },
  };
}
