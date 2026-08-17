import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CodexCliExecutor, createCodexCliExecutor } from "../codex/codex-cli-executor.js";
import {
  assistantExecutionProfile,
  type CodexExecutionProfileResolver,
  codexExecutionArguments,
} from "../codex/codex-execution-profile.js";
import { conversationFeatureArguments, threadFromEvents } from "../codex/codex-thread.js";

/** Evidence travels inline, so the request bound is generous; the answer stays a bounded JSON. */
const maximumInputBytes = 256 * 1024;
const maximumOutputBytes = 128 * 1024;

export interface AssistantRuntimeTurn {
  /** Resume this Codex thread; null opens a new one. */
  readonly threadId: string | null;
  readonly prompt: string;
  readonly schema: object;
}

export interface AssistantRuntimeResult {
  readonly threadId: string | null;
  readonly output: string;
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly durationMs: number;
}

/** Thrown when the model could not be reached or answered outside the transport; never contains model text. */
export class AssistantRuntimeError extends Error {
  constructor(
    readonly modelId: string,
    readonly durationMs: number,
    cause: unknown,
  ) {
    super("Assistant runtime failed", { cause });
  }
}

export interface AssistantRuntime {
  run(turn: AssistantRuntimeTurn): Promise<AssistantRuntimeResult>;
}

export function createCodexAssistantRuntime(
  options: {
    resolveExecutionProfile: CodexExecutionProfileResolver;
    timeoutMs: number;
  },
  executor: CodexCliExecutor = createCodexCliExecutor({
    timeoutMs: options.timeoutMs,
    maximumInputBytes,
    maximumOutputBytes,
  }),
): AssistantRuntime {
  if (options.timeoutMs < 1_000) throw new Error("Codex assistant configuration is invalid");
  return {
    async run(turn) {
      const profile = assistantExecutionProfile(await options.resolveExecutionProfile());
      const startedAt = Date.now();
      const directory = await mkdtemp(join(tmpdir(), "veylta-assistant-"));
      const schemaPath = join(directory, "output.schema.json");
      const outputPath = join(directory, "output.json");
      try {
        await writeFile(schemaPath, JSON.stringify(turn.schema), { encoding: "utf8", mode: 0o600 });
        const common = [
          "--json",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          ...codexExecutionArguments(profile),
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          ...conversationFeatureArguments(),
          "-c",
          'sandbox_mode="read-only"',
          // The evidence must not leave for a search provider either, cached or live.
          "-c",
          'web_search="disabled"',
        ];
        const arguments_ =
          turn.threadId === null
            ? ["exec", "--sandbox", "read-only", ...common, "-C", directory, "-"]
            : ["exec", "resume", ...common, turn.threadId, "-"];
        const result = await executor(arguments_, turn.prompt, {
          cwd: directory,
          outputPath,
          schemaPath,
          writeOutput: (value) => writeFile(outputPath, value, { encoding: "utf8", mode: 0o600 }),
        });
        const output = await readFile(outputPath, "utf8");
        if (Buffer.byteLength(output, "utf8") > maximumOutputBytes) {
          throw new Error("Codex assistant output exceeded its bound");
        }
        return {
          threadId: threadFromEvents(result.stdout) ?? turn.threadId,
          output,
          modelId: profile.modelId,
          runtimeVersion: result.runtimeVersion,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        throw new AssistantRuntimeError(profile.modelId, Date.now() - startedAt, error);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
}
