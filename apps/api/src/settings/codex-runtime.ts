import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const commandTimeoutMs = 10_000;
const maximumOutputBytes = 64 * 1024;

type CommandResult = Readonly<{ stdout: string; stderr: string }>;
type CommandExecutor = (arguments_: readonly string[]) => Promise<CommandResult>;

export interface CodexRuntimeProbeResult {
  installed: boolean;
  authenticated: boolean;
  authenticationMode: "chatgpt" | "api_key" | "unknown" | null;
  daemonRunning: boolean;
  cliVersion: string | null;
  runtimeVersion: string | null;
}

export interface CodexRuntimeProbe {
  status(): Promise<CodexRuntimeProbeResult>;
  startDaemon(): Promise<CodexRuntimeProbeResult>;
}

async function executeCodex(arguments_: readonly string[]): Promise<CommandResult> {
  const { stdout, stderr } = await execute("codex", arguments_, {
    timeout: commandTimeoutMs,
    maxBuffer: maximumOutputBytes,
    windowsHide: true,
  });
  return { stdout, stderr };
}

async function command(
  arguments_: readonly string[],
  executor: CommandExecutor,
): Promise<string | null> {
  try {
    const { stdout, stderr } = await executor(arguments_);
    const output = [stdout, stderr]
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n");
    return output || null;
  } catch {
    return null;
  }
}

function authenticationMode(output: string | null): CodexRuntimeProbeResult["authenticationMode"] {
  if (output === null) return null;
  if (/ChatGPT/i.test(output)) return "chatgpt";
  if (/API key/i.test(output)) return "api_key";
  return "unknown";
}

function safeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  return /^[a-z0-9][a-z0-9._+() -]{0,119}$/i.test(version) ? version : null;
}

function runtimeVersion(output: string | null): string | null {
  if (output === null) return null;
  try {
    const value = JSON.parse(output) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    for (const key of ["appServerVersion", "app_server_version", "version"]) {
      const version = safeVersion(record[key]);
      if (version !== null) return version;
    }
    return null;
  } catch {
    return null;
  }
}

export function createCodexRuntimeProbe(
  executor: CommandExecutor = executeCodex,
): CodexRuntimeProbe {
  async function status(): Promise<CodexRuntimeProbeResult> {
    const cliVersion = await command(["--version"], executor);
    if (cliVersion === null) {
      return {
        installed: false,
        authenticated: false,
        authenticationMode: null,
        daemonRunning: false,
        cliVersion: null,
        runtimeVersion: null,
      };
    }
    const login = await command(["login", "status"], executor);
    const daemon = await command(["app-server", "daemon", "version"], executor);
    return {
      installed: true,
      authenticated: login !== null && /^Logged in/i.test(login),
      authenticationMode: authenticationMode(login),
      daemonRunning: daemon !== null,
      cliVersion: safeVersion(cliVersion),
      runtimeVersion: runtimeVersion(daemon),
    };
  }

  return {
    status,
    async startDaemon() {
      const before = await status();
      if (!before.installed || !before.authenticated) return before;
      await command(["app-server", "daemon", "start"], executor);
      return status();
    },
  };
}
