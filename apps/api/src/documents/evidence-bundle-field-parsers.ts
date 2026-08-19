/** Primitive readers for `evidence-bundle-verifier.ts`: they verify untrusted JSON or refuse. */
export class EvidenceBundleVerificationError extends Error {
  constructor() {
    super("Evidence bundle verification failed");
    this.name = "EvidenceBundleVerificationError";
  }
}

export function fail(): never {
  throw new EvidenceBundleVerificationError();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

export function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) fail();
  return value;
}

export function nullableBoundedString(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  const string = requiredString(value, maximum);
  if (string !== string.trim()) fail();
  return string;
}

export function nullableStoredText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  return requiredString(value, maximum);
}

export function requiredBoundedString(value: unknown, maximum: number): string {
  const string = nullableBoundedString(value, maximum);
  if (string === null) fail();
  return string;
}

export function requiredStoredText(value: unknown, maximum: number): string {
  const string = nullableStoredText(value, maximum);
  if (string === null) fail();
  return string;
}

export function requiredCanonicalUuid(value: unknown): string {
  const uuid = requiredString(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(uuid)) fail();
  return uuid;
}

export function requiredTimestamp(value: unknown): string {
  const timestamp = requiredString(value, 30);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) fail();
  return timestamp;
}

export function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return requiredTimestamp(value);
}
