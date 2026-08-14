#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { bridgeStatePath } from "./paths.mjs";

function usage() {
  console.error(
    "Usage: node scripts/poll.mjs [--worker id] [--wait ms] | --complete command-id lease-token | --fail command-id lease-token SAFE_CODE | --status",
  );
}

async function bridgeInfo() {
  try {
    const value = JSON.parse(await readFile(bridgeStatePath(), "utf8"));
    if (
      typeof value?.baseUrl !== "string" ||
      !value.baseUrl.startsWith("http://127.0.0.1:") ||
      typeof value?.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.token)
    ) {
      throw new Error("invalid state");
    }
    return value;
  } catch {
    throw new Error("Veylta bridge is not running");
  }
}

async function request(info, path, init = {}) {
  const response = await fetch(`${info.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${info.token}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
  if (response.status === 204) return { type: "timeout" };
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Bridge request failed: ${body?.error?.code ?? response.status}`);
  }
  return body;
}

const args = process.argv.slice(2);
try {
  const info = await bridgeInfo();
  if (args[0] === "--status") {
    console.log(JSON.stringify(await request(info, "/v1/status")));
    process.exit(0);
  }

  if (args[0] === "--complete" || args[0] === "--fail") {
    const [mode, commandId, leaseToken, failureCode] = args;
    if (
      commandId === undefined ||
      leaseToken === undefined ||
      (mode === "--complete" && args.length !== 3) ||
      (mode === "--fail" && args.length !== 4)
    ) {
      usage();
      process.exit(2);
    }
    const workerId = process.env.VEYLTA_AGENT_WORKER ?? `codex-${process.pid}`;
    console.log(
      JSON.stringify(
        await request(info, `/v1/commands/${encodeURIComponent(commandId)}/complete`, {
          method: "POST",
          body: JSON.stringify({
            workerId,
            leaseToken,
            outcome: mode === "--complete" ? "completed" : "failed",
            ...(mode === "--fail" ? { failureCode } : {}),
          }),
        }),
      ),
    );
    process.exit(0);
  }

  const workerIndex = args.indexOf("--worker");
  const waitIndex = args.indexOf("--wait");
  const workerId =
    workerIndex === -1
      ? (process.env.VEYLTA_AGENT_WORKER ?? `codex-${process.pid}`)
      : args[workerIndex + 1];
  const wait = waitIndex === -1 ? "30000" : args[waitIndex + 1];
  if (
    workerId === undefined ||
    wait === undefined ||
    args.some((argument, index) => {
      if (argument === "--worker" || argument === "--wait") return false;
      if (index > 0 && (args[index - 1] === "--worker" || args[index - 1] === "--wait")) {
        return false;
      }
      return true;
    })
  ) {
    usage();
    process.exit(2);
  }
  console.log(
    JSON.stringify(
      await request(
        info,
        `/v1/commands/claim?workerId=${encodeURIComponent(workerId)}&waitMs=${encodeURIComponent(wait)}`,
      ),
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Veylta agent command failed");
  process.exit(1);
}
