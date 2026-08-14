import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  CODEX_REASONING_EFFORTS,
  type CodexModelOption,
  type CodexReasoningEffort,
  type CodexUsageLimit,
} from "@veylta/contracts";

const execute = promisify(execFile);
const commandTimeoutMs = 10_000;
const maximumOutputBytes = 64 * 1024;
const modelPattern = /^[a-z0-9][a-z0-9._-]{1,79}$/i;
const reasoningEfforts = new Set<string>(CODEX_REASONING_EFFORTS);

type CommandResult = Readonly<{ stdout: string; stderr: string }>;
type CommandExecutor = (arguments_: readonly string[]) => Promise<CommandResult>;
type AppServerSnapshot = Readonly<{ models: unknown; rateLimits: unknown }>;
type AppServerReader = () => Promise<AppServerSnapshot>;

export interface CodexRuntimeProbeResult {
  installed: boolean;
  authenticated: boolean;
  authenticationMode: "chatgpt" | "api_key" | "unknown" | null;
  daemonRunning: boolean;
  cliVersion: string | null;
  runtimeVersion: string | null;
  models: readonly CodexModelOption[];
  usageLimits: readonly CodexUsageLimit[];
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

async function readCodexAppServer(): Promise<AppServerSnapshot> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    let models: unknown;
    let rateLimits: unknown;
    let initialized = false;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (error !== undefined) reject(error);
      else resolve({ models, rateLimits });
    };
    const timeout = setTimeout(
      () => finish(new Error("Codex app server did not answer in time")),
      commandTimeoutMs,
    );
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    const consume = () => {
      while (true) {
        const newline = output.indexOf("\n");
        if (newline < 0) return;
        const line = output.slice(0, newline).trim();
        output = output.slice(newline + 1);
        if (line.length === 0) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof message !== "object" || message === null) continue;
        const record = message as Record<string, unknown>;
        if (record.id === 1 && "result" in record && !initialized) {
          initialized = true;
          send({ method: "initialized" });
          send({ id: 2, method: "model/list", params: {} });
          send({ id: 3, method: "account/rateLimits/read", params: {} });
        } else if (record.id === 2) {
          models = record.result;
        } else if (record.id === 3) {
          rateLimits = record.result;
        }
        if (models !== undefined && rateLimits !== undefined) finish();
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output, "utf8") > maximumOutputBytes) {
        finish(new Error("Codex app server output is too large"));
        return;
      }
      consume();
    });
    child.stderr.on("data", (chunk: string) => {
      errors += chunk;
      if (Buffer.byteLength(errors, "utf8") > maximumOutputBytes) {
        finish(new Error("Codex app server error output is too large"));
      }
    });
    child.once("error", (error) => finish(error));
    child.once("exit", () => {
      if (!settled) finish(new Error("Codex app server exited before answering"));
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "veylta", title: "Veylta", version: "1" },
        capabilities: { experimentalApi: true },
      },
    });
  });
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

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reasoning(value: unknown): CodexReasoningEffort | null {
  const record = object(value);
  const candidate = typeof value === "string" ? value : (record?.reasoningEffort ?? record?.effort);
  return typeof candidate === "string" && reasoningEfforts.has(candidate)
    ? (candidate as CodexReasoningEffort)
    : null;
}

function modelsFrom(value: unknown): readonly CodexModelOption[] {
  const root = object(value);
  const candidates = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(root?.models)
      ? root.models
      : [];
  const models: CodexModelOption[] = [];
  for (const candidate of candidates) {
    const row = object(candidate);
    const id = row?.id ?? row?.model;
    const displayName = row?.displayName ?? row?.display_name ?? id;
    const supportedRaw = row?.supportedReasoningEfforts ?? row?.supported_reasoning_efforts;
    const supported = Array.isArray(supportedRaw)
      ? supportedRaw.map(reasoning).filter((item): item is CodexReasoningEffort => item !== null)
      : [];
    const defaultEffort = reasoning(row?.defaultReasoningEffort ?? row?.default_reasoning_effort);
    const tiers = row?.serviceTiers ?? row?.service_tiers ?? row?.supportedServiceTiers;
    const supportsFastMode =
      Array.isArray(tiers) &&
      tiers.some((tier) => {
        const item = object(tier);
        return tier === "priority" || item?.id === "priority" || item?.name === "priority";
      });
    const upgrade = row?.upgradeModel ?? row?.upgrade_model ?? row?.upgrade;
    const upgradeRecord = object(upgrade);
    const upgradeId = typeof upgrade === "string" ? upgrade : upgradeRecord?.id;
    if (
      typeof id !== "string" ||
      !modelPattern.test(id) ||
      typeof displayName !== "string" ||
      displayName.trim().length < 1 ||
      displayName.length > 120 ||
      supported.length === 0 ||
      defaultEffort === null ||
      !supported.includes(defaultEffort)
    ) {
      continue;
    }
    models.push({
      id,
      displayName: displayName.trim(),
      isDefault: row?.isDefault === true || row?.is_default === true,
      defaultReasoningEffort: defaultEffort,
      supportedReasoningEfforts: [...new Set(supported)],
      supportsFastMode,
      upgradeModelId:
        typeof upgradeId === "string" && modelPattern.test(upgradeId) ? upgradeId : null,
    });
  }
  return models;
}

function limitFrom(name: string, value: unknown): CodexUsageLimit | null {
  const row = object(value);
  const used = row?.usedPercent ?? row?.used_percent;
  const duration = row?.windowDurationMins ?? row?.windowDurationMinutes ?? row?.window_minutes;
  const reset = row?.resetsAt ?? row?.resets_at;
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    typeof duration !== "number" ||
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    duration > 525_600 ||
    typeof reset !== "number" ||
    !Number.isSafeInteger(reset)
  ) {
    return null;
  }
  const usedPercent = Math.max(0, Math.min(100, Math.round(used)));
  const resetsAt = new Date(reset * 1_000);
  if (!Number.isFinite(resetsAt.getTime())) return null;
  return {
    name: name.trim().toLowerCase() === "codex" ? "Codex" : name.trim().slice(0, 80) || "Codex",
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMinutes: duration,
    resetsAt: resetsAt.toISOString(),
  };
}

function usageLimitsFrom(value: unknown): readonly CodexUsageLimit[] {
  const root = object(value);
  const limits = object(root?.rateLimitsByLimitId ?? root?.rate_limits_by_limit_id);
  if (limits !== null) {
    return Object.entries(limits)
      .flatMap(([name, candidate]) => {
        const group = object(candidate);
        const displayName =
          typeof group?.limitName === "string"
            ? group.limitName
            : typeof group?.name === "string"
              ? group.name
              : name;
        return [group?.primary, group?.secondary]
          .map((window, index) =>
            limitFrom(index === 0 ? displayName : `${displayName} · дополнительный`, window),
          )
          .filter((item): item is CodexUsageLimit => item !== null);
      })
      .slice(0, 8);
  }
  const rateLimits = object(root?.rateLimits ?? root?.rate_limits ?? root);
  if (rateLimits === null) return [];
  return [
    limitFrom("Codex", rateLimits.primary),
    limitFrom("Codex · дополнительный", rateLimits.secondary),
  ].filter((item): item is CodexUsageLimit => item !== null);
}

export function createCodexRuntimeProbe(
  executor: CommandExecutor = executeCodex,
  appServerReader: AppServerReader = readCodexAppServer,
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
        models: [],
        usageLimits: [],
      };
    }
    const login = await command(["login", "status"], executor);
    const daemon = await command(["app-server", "daemon", "version"], executor);
    const authenticated = login !== null && /^Logged in/i.test(login);
    let snapshot: AppServerSnapshot | null = null;
    if (authenticated) {
      try {
        snapshot = await appServerReader();
      } catch {
        snapshot = null;
      }
    }
    return {
      installed: true,
      authenticated,
      authenticationMode: authenticationMode(login),
      daemonRunning: daemon !== null,
      cliVersion: safeVersion(cliVersion),
      runtimeVersion: runtimeVersion(daemon),
      models: modelsFrom(snapshot?.models),
      usageLimits: usageLimitsFrom(snapshot?.rateLimits),
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
