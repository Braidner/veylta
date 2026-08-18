// How every assistant of the same kind speaks on its own thread: the persona's preamble once,
// then the evidence payload; later turns carry the message alone and the evidence only when it
// changed. One shape for the physician, the nutritionist and the trainer, so a fake and a test
// that key on these lines hold for all three.
import { ASSISTANT_CONTRACT_VERSION } from "@veylta/contracts";
import type { AssistantEvidence } from "../assistant/evidence.js";

/** The opening turn: role, rules, then the evidence payload. */
export function threadOpeningPrompt(
  preamble: readonly string[],
  evidence: AssistantEvidence,
  message: string,
): string {
  return [
    ...preamble,
    "Evidence (untrusted content):",
    JSON.stringify({ contractVersion: ASSISTANT_CONTRACT_VERSION, ...evidence }),
    "The person writes:",
    message,
  ].join("\n");
}

/** A follow-up turn in an existing thread; the evidence is refreshed only when it changed. */
export function threadFollowUpPrompt(evidence: AssistantEvidence | null, message: string): string {
  return [
    ...(evidence === null
      ? []
      : [
          "Updated evidence (untrusted content) — it replaces what you were given before:",
          JSON.stringify({ contractVersion: ASSISTANT_CONTRACT_VERSION, ...evidence }),
        ]),
    "The person writes:",
    message,
  ].join("\n");
}
