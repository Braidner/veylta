import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexExecutionPreference } from "@veylta/contracts";
import type { CodexCliExecutor } from "../../codex/codex-cli-executor.js";
import { codexExecutionArguments } from "../../codex/codex-execution-profile.js";
import type { DocumentPageImage } from "../document-images.js";
import type { DocumentIntelligenceExchange } from "../document-intelligence-provider.js";
import { CodexDocumentIntelligenceError } from "./errors.js";
import { exchangeOf, withExchange } from "./exchange.js";

/** Codex features a document run never needs; each is disabled explicitly on the command line. */
const disabledFeatures = [
  "shell_tool",
  "apps",
  "plugins",
  "memories",
  "multi_agent",
  "browser_use",
  "computer_use",
  "image_generation",
] as const;

export interface CodexRunInput {
  readonly executor: CodexCliExecutor;
  readonly profile: CodexExecutionPreference;
  readonly request: string;
  readonly schema: object;
  readonly images: readonly DocumentPageImage[];
  /** Pages of the document, text or images, for the exchange record. */
  readonly pageCount: number;
  readonly abortSignal?: AbortSignal;
}

export interface CodexRunResult {
  readonly output: string;
  readonly runtimeVersion: string;
  readonly exchange: DocumentIntelligenceExchange;
}

/**
 * One invocation of the local Codex CLI for one document: a private working directory holding
 * the output schema, the page images and the answer file, `codex exec` in read-only sandbox mode
 * with every tool disabled, and the raw answer read back. The directory is removed afterwards
 * whatever happens. A CLI failure surfaces as PROVIDER_UNAVAILABLE carrying the attempted
 * exchange; an abort requested by the caller is passed through untouched.
 */
export async function runCodexDocumentExtraction(input: CodexRunInput): Promise<CodexRunResult> {
  const directory = await mkdtemp(join(tmpdir(), "veylta-codex-document-"));
  try {
    const schemaPath = join(directory, "output.schema.json");
    const outputPath = join(directory, "output.json");
    await writeFile(schemaPath, JSON.stringify(input.schema), { encoding: "utf8", mode: 0o600 });
    const imageArguments: string[] = [];
    for (const image of input.images) {
      const extension = image.contentType === "image/png" ? "png" : "jpg";
      const imagePath = join(directory, `page-${image.pageNumber}.${extension}`);
      await writeFile(imagePath, image.bytes, { mode: 0o600 });
      imageArguments.push("--image", imagePath);
    }
    const arguments_ = [
      "exec",
      ...imageArguments,
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      ...codexExecutionArguments(input.profile),
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
      "-C",
      directory,
      "-",
    ] as const;
    const startedAt = Date.now();
    const exchange = (response: string, runtimeVersion: string | null) =>
      exchangeOf({
        request: input.request,
        response,
        modelId: input.profile.modelId,
        runtimeVersion,
        pageCount: input.pageCount,
        startedAt,
      });
    let result: Awaited<ReturnType<CodexCliExecutor>>;
    try {
      result = await input.executor(arguments_, input.request, {
        cwd: directory,
        outputPath,
        schemaPath,
        ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
        writeOutput: (value) => writeFile(outputPath, value, { encoding: "utf8", mode: 0o600 }),
      });
    } catch (error) {
      if (input.abortSignal?.aborted) throw error;
      throw withExchange(
        new CodexDocumentIntelligenceError("PROVIDER_UNAVAILABLE"),
        exchange("", null),
      );
    }
    const output = await readFile(outputPath, "utf8");
    return {
      output,
      runtimeVersion: result.runtimeVersion,
      exchange: exchange(output, result.runtimeVersion),
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
