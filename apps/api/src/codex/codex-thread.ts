/**
 * Shared by every conversational `codex exec` (document dialogues, assistants): the CLI
 * features a Veylta conversation may never use, and the thread id the CLI announces on
 * `--json` stdout so a later turn can `exec resume` it.
 */
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

export function conversationFeatureArguments(): string[] {
  return disabledFeatures.flatMap((feature) => ["--disable", feature]);
}

export function threadFromEvents(stdout: string): string | null {
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
