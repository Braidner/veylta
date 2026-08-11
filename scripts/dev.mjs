import { spawn } from "node:child_process";

const commands = [
  ["api", ["--filter", "@family-health/api", "dev:api"]],
  ["worker", ["--filter", "@family-health/api", "dev:worker"]],
  ["web", ["--filter", "@family-health/web", "dev"]],
];

const children = commands.map(([name, args]) => {
  const child = spawn("pnpm", args, {
    stdio: "inherit",
    env: process.env,
  });
  child.once("exit", (code, signal) => {
    if (signal === null && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      stop("SIGTERM");
      process.exitCode = code ?? 1;
    }
  });
  return child;
});

let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
