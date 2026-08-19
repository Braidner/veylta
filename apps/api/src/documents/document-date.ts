import type { DocumentEffectiveDate } from "@veylta/contracts";

/** `YYYY-MM-DD` naming a real day (no `2026-02-30`, no timestamp, no short form). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The one rule for a document's date: what the person said, else what the document says,
 * else the day it was uploaded (UTC). Every projection and the timeline order read this.
 */
export function effectiveDocumentDate(input: {
  readonly override: string | null;
  readonly documentDate: string | null;
  readonly uploadedAt: string;
}): DocumentEffectiveDate {
  if (input.override !== null) return { value: input.override, source: "person" };
  if (input.documentDate !== null) return { value: input.documentDate, source: "document" };
  return { value: new Date(input.uploadedAt).toISOString().slice(0, 10), source: "upload" };
}

/**
 * The same rule as SQL, for ordering and paging in the timeline query; `alias` is the documents
 * alias. `substr(uploaded_at, 1, 10)` is the UTC calendar day because every writer stores a
 * `Z`-suffixed ISO timestamp, and the column's own DEFAULT is
 * `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` — there is no offset to account for.
 */
export function effectiveDateSql(alias: string, intelligenceAlias: string): string {
  return `COALESCE(${alias}.document_date_override, ${intelligenceAlias}.document_date, substr(${alias}.uploaded_at, 1, 10))`;
}
