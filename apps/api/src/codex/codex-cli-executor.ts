import { spawn } from "node:child_process";

export interface CodexExecutorFiles {
  cwd: string;
  outputPath: string;
  schemaPath: string;
  /** Per-invocation secrets are passed only through the child environment, never CLI arguments. */
  environment?: Readonly<Record<string, string>>;
  /** Kills the child on abort so a stopping worker never leaves an orphaned model process. */
  abortSignal?: AbortSignal;
  writeOutput(value: string): Promise<void>;
}

export type CodexCliExecutor = (
  arguments_: readonly string[],
  input: string,
  files: CodexExecutorFiles,
) => Promise<{ stdout: string; stderr: string; runtimeVersion: string }>;

function boundedAppend(current: string, chunk: Buffer, maximumOutputBytes: number): string {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next, "utf8") > maximumOutputBytes) {
    throw new Error("Codex output exceeded its bounded transport");
  }
  return next;
}

async function runProcess(
  command: string,
  arguments_: readonly string[],
  input: string,
  options: {
    timeoutMs: number;
    maximumInputBytes: number;
    maximumOutputBytes: number;
    environment?: Readonly<Record<string, string>>;
    abortSignal?: AbortSignal;
  },
): Promise<{ stdout: string; stderr: string }> {
  if (Buffer.byteLength(input, "utf8") > options.maximumInputBytes) {
    throw new Error("Codex input exceeded its bounded transport");
  }
  return new Promise((resolve, reject) => {
    const environment = { ...process.env };
    delete environment.OPENAI_API_KEY;
    delete environment.OPENAI_BASE_URL;
    delete environment.OPENAI_ORG_ID;
    delete environment.OPENAI_PROJECT_ID;
    Object.assign(environment, options.environment);
    const child = spawn(command, arguments_, {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.abortSignal?.removeEventListener("abort", onAbort);
      operation();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("Codex execution timed out")));
    }, options.timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("Codex execution aborted")));
    };
    if (options.abortSignal?.aborted) onAbort();
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => finish(() => reject(error)));
    child.stdin.once("error", (error) => finish(() => reject(error)));
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdout = boundedAppend(stdout, chunk, options.maximumOutputBytes);
      } catch (error) {
        child.kill("SIGKILL");
        finish(() => reject(error));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        stderr = boundedAppend(stderr, chunk, options.maximumOutputBytes);
      } catch (error) {
        child.kill("SIGKILL");
        finish(() => reject(error));
      }
    });
    child.once("close", (code, signal) => {
      finish(() => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`Codex exited with ${signal ?? code}`));
      });
    });
    child.stdin.end(input);
  });
}

export function createCodexCliExecutor(options: {
  timeoutMs: number;
  maximumInputBytes: number;
  maximumOutputBytes: number;
}): CodexCliExecutor {
  return async (arguments_, input, files) => {
    const commandOptions = {
      ...options,
      timeoutMs: Math.min(options.timeoutMs, 10_000),
    };
    const version = await runProcess("codex", ["--version"], "", commandOptions);
    const runtimeVersion = version.stdout.trim();
    if (!/^codex-cli [a-z0-9._+-]{1,100}$/i.test(runtimeVersion)) {
      throw new Error("Codex runtime version is unavailable");
    }
    const login = await runProcess("codex", ["login", "status"], "", commandOptions);
    if (!/Logged in using ChatGPT/i.test(`${login.stdout}\n${login.stderr}`)) {
      throw new Error("Codex ChatGPT subscription is unavailable");
    }
    const result = await runProcess("codex", arguments_, input, {
      ...options,
      ...(files.environment === undefined ? {} : { environment: files.environment }),
      ...(files.abortSignal === undefined ? {} : { abortSignal: files.abortSignal }),
    });
    return { ...result, runtimeVersion };
  };
}
