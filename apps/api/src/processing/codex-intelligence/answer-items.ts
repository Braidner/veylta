import { limits } from "./constants.js";
import { CodexDocumentIntelligenceError } from "./errors.js";

/**
 * Keys only bind results to facts inside one answer and seed stable fact IDs. A repeated key is
 * a bookkeeping slip, not a provenance error, so the later holder gets a derived key
 * (`key-2`, `key-3`, …) instead of the run failing or a measurement being dropped. Bounded to
 * the same length as any key.
 */
export class KeyRegistry {
  private readonly taken: Set<string>;

  constructor(taken: Iterable<string> = []) {
    this.taken = new Set(taken);
  }

  has(key: string): boolean {
    return this.taken.has(key);
  }

  /** Registers the key, or the first free derivative of it, and returns what was registered. */
  claim(key: string): string {
    const claimed = this.freeKey(key);
    this.taken.add(claimed);
    return claimed;
  }

  private freeKey(key: string): string {
    if (!this.taken.has(key)) return key;
    for (let ordinal = 2; ; ordinal += 1) {
      const suffix = `-${ordinal}`;
      const candidate = `${key.slice(0, limits.keyCharacters - suffix.length)}${suffix}`;
      if (!this.taken.has(candidate)) return candidate;
    }
  }
}

/**
 * Each proposed result or fact is verified on its own: one that breaks a rule is dropped so
 * that nothing unbound ever surfaces, while the verified rest of the answer is kept. An answer
 * whose every item fails is refused outright, naming the last rule it broke — that is a
 * broken answer, not a slip.
 */
export function keptItems<Item>(
  proposals: readonly unknown[],
  parse: (proposal: unknown) => Item,
): Item[] {
  const kept: Item[] = [];
  let lastRejection: CodexDocumentIntelligenceError | null = null;
  for (const proposal of proposals) {
    try {
      kept.push(parse(proposal));
    } catch (error) {
      if (!(error instanceof CodexDocumentIntelligenceError) || error.code !== "OUTPUT_INVALID") {
        throw error;
      }
      lastRejection = error;
    }
  }
  if (lastRejection !== null && kept.length === 0) throw lastRejection;
  return kept;
}
