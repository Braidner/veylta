import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CodexCliExecutor, createCodexCliExecutor } from "../codex/codex-cli-executor.js";
import {
  type CodexExecutionProfileResolver,
  codexExecutionArguments,
} from "../codex/codex-execution-profile.js";
import { documentAgentInitialPrompt } from "../prompts/document-agent.prompt.js";

const maximumOutputBytes = 64 * 1024;
const capabilityEnvironmentName = "VEYLTA_DOCUMENT_AGENT_TOKEN";
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

export interface DocumentAgentRuntimeResult {
  readonly threadId: string;
  readonly text: string;
  readonly modelId: string;
  readonly runtimeVersion: string;
}

export interface DocumentAgentRuntime {
  respond(input: {
    threadId: string | null;
    message: string;
    capabilityToken: string;
  }): Promise<DocumentAgentRuntimeResult>;
}

const outputSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 2_000 },
  },
} as const;

function threadFromEvents(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "thread.started" &&
      "thread_id" in event &&
      typeof event.thread_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        event.thread_id,
      )
    ) {
      return event.thread_id;
    }
  }
  return null;
}

function responseText(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Codex document agent output is invalid");
  }
  const message =
    typeof parsed === "object" && parsed !== null && "message" in parsed
      ? parsed.message
      : undefined;
  if (
    typeof message !== "string" ||
    message !== message.trim() ||
    message.length < 1 ||
    message.length > 2_000 ||
    !/[А-Яа-яЁё]/.test(message)
  ) {
    throw new Error("Codex document agent output is invalid");
  }
  return message;
}

function mcpConfiguration(url: string): readonly string[] {
  return [
    "-c",
    `mcp_servers.veylta.url=${JSON.stringify(url)}`,
    "-c",
    `mcp_servers.veylta.bearer_token_env_var=${JSON.stringify(capabilityEnvironmentName)}`,
    "-c",
    'sandbox_mode="read-only"',
  ];
}

function featureArguments(): string[] {
  return disabledFeatures.flatMap((feature) => ["--disable", feature]);
}

export function createCodexDocumentAgentRuntime(
  options: {
    mcpUrl: string;
    resolveExecutionProfile: CodexExecutionProfileResolver;
    timeoutMs: number;
  },
  executor: CodexCliExecutor = createCodexCliExecutor({
    timeoutMs: options.timeoutMs,
    maximumInputBytes: 8 * 1024,
    maximumOutputBytes,
  }),
): DocumentAgentRuntime {
  const parsedUrl = new URL(options.mcpUrl);
  if (
    parsedUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsedUrl.hostname) ||
    options.timeoutMs < 1_000
  ) {
    throw new Error("Codex document agent configuration is invalid");
  }

  return {
    async respond(input) {
      const profile = await options.resolveExecutionProfile();
      const directory = await mkdtemp(join(tmpdir(), "veylta-document-agent-"));
      const schemaPath = join(directory, "output.schema.json");
      const outputPath = join(directory, "output.json");
      await writeFile(schemaPath, JSON.stringify(outputSchema), { encoding: "utf8", mode: 0o600 });
      try {
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
          ...featureArguments(),
          ...mcpConfiguration(options.mcpUrl),
        ];
        const arguments_ =
          input.threadId === null
            ? ["exec", "--sandbox", "read-only", ...common, "-C", directory, "-"]
            : ["exec", "resume", ...common, input.threadId, "-"];
        const result = await executor(
          arguments_,
          input.threadId === null ? documentAgentInitialPrompt(input.message) : input.message,
          {
            cwd: directory,
            outputPath,
            schemaPath,
            environment: { [capabilityEnvironmentName]: input.capabilityToken },
            writeOutput: (value) => writeFile(outputPath, value, { encoding: "utf8", mode: 0o600 }),
          },
        );
        const discoveredThreadId = threadFromEvents(result.stdout) ?? input.threadId;
        if (discoveredThreadId === null) {
          throw new Error("Codex document agent output is invalid");
        }
        const output = await readFile(outputPath, "utf8");
        if (Buffer.byteLength(output, "utf8") > maximumOutputBytes) {
          throw new Error("Codex document agent output is invalid");
        }
        return {
          threadId: discoveredThreadId,
          text: responseText(output),
          modelId: profile.modelId,
          runtimeVersion: result.runtimeVersion,
        };
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
}
