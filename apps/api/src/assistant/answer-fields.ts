import type { AssistantRejectionReason } from "@veylta/contracts";

/** The answer broke a closed rule; the reason is what the UI shows, never model text. */
export class AssistantAnswerError extends Error {
  constructor(readonly reason: AssistantRejectionReason) {
    super(`Assistant answer refused: ${reason}`);
    this.name = "AssistantAnswerError";
  }
}

export function refuse(reason: AssistantRejectionReason): never {
  throw new AssistantAnswerError(reason);
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse("schema_shape");
  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) refuse("schema_shape");
}

export function member<Member extends string>(value: unknown, members: readonly Member[]): Member {
  if (typeof value !== "string" || !members.includes(value as Member)) refuse("schema_shape");
  return value as Member;
}

export function boundedList(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) refuse("schema_shape");
  return value;
}

export function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string") refuse("schema_shape");
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximum) refuse("schema_shape");
  if ([...trimmed].some((character) => (character.codePointAt(0) ?? 0) < 32)) {
    refuse("schema_shape");
  }
  return trimmed;
}

/** Prose the person reads is Russian; codes and units inside it are fine. */
export function russianText(value: unknown, maximum: number): string {
  const text = boundedText(value, maximum);
  if (!/[А-Яа-яЁё]/u.test(text)) refuse("not_russian");
  return text;
}

/**
 * Each proposal is verified on its own: one that breaks a rule is dropped, the rest is kept, and
 * only a list whose every member fails is refused — naming the last rule broken.
 */
export function keepEach<Item>(
  proposals: readonly unknown[],
  parse: (proposal: unknown) => Item,
): Item[] {
  const kept: Item[] = [];
  let lastRefusal: AssistantAnswerError | null = null;
  for (const proposal of proposals) {
    try {
      kept.push(parse(proposal));
    } catch (error) {
      if (!(error instanceof AssistantAnswerError)) throw error;
      // A profile that is not ready and Latin prose are answer-level faults, not one bad block.
      if (error.reason === "profile_not_ready" || error.reason === "not_russian") throw error;
      lastRefusal = error;
    }
  }
  if (lastRefusal !== null && kept.length === 0) throw lastRefusal;
  return kept;
}
