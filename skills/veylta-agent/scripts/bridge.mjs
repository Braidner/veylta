#!/usr/bin/env node
import { resolve } from "node:path";
import { createLocalAgentBridge } from "./bridge-lib.mjs";
import { agentStateDirectory } from "./paths.mjs";

function usage() {
  console.error("Usage: node scripts/bridge.mjs start --vault /absolute/path/to/Veylta-Vault");
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

const args = process.argv.slice(2);
if (args[0] !== "start") {
  usage();
  process.exit(2);
}

const allowed = new Set(["start", "--vault", "--state"]);
for (const argument of args) {
  if (argument.startsWith("--") && !allowed.has(argument)) {
    usage();
    process.exit(2);
  }
}

try {
  const vault = option(args, "--vault");
  if (vault === undefined) {
    usage();
    process.exit(2);
  }
  const bridge = await createLocalAgentBridge({
    vaultPath: resolve(vault),
    stateDirectory: resolve(option(args, "--state") ?? agentStateDirectory()),
  });
  console.log(
    JSON.stringify({
      status: "listening",
      protocolVersion: "veylta-agent/v1",
      baseUrl: bridge.baseUrl,
      vaultId: bridge.vaultId,
      statePath: bridge.statePath,
    }),
  );

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await bridge.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
} catch (error) {
  console.error(
    JSON.stringify({
      status: "error",
      code: typeof error?.code === "string" ? error.code : "BRIDGE_START_FAILED",
    }),
  );
  process.exit(1);
}
