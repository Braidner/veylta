import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function agentStateDirectory() {
  return resolve(process.env.VEYLTA_AGENT_HOME ?? join(homedir(), ".veylta-agent"));
}

export function bridgeStatePath() {
  return join(agentStateDirectory(), "bridge.json");
}
