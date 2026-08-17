import {
  CLINICIAN_RECORD_KINDS,
  type DocumentIntelligenceStructuredResult,
} from "@veylta/contracts";

/**
 * The synthetic discharge-note grammar the test doubles read: one `RECORD|kind|label|detail`
 * line per statement (detail `-` for none), a `Дата: YYYY-MM-DD` line for the document date.
 * Mirrors scripts/fake-codex-exec.mjs, which the e2e stand runs; both are stand-ins for a
 * model that reads a real note, and neither reads anything but this grammar.
 */
const kinds: ReadonlySet<string> = new Set(CLINICIAN_RECORD_KINDS);
const datePattern = /^Дата:\s*(\d{4}-\d{2}-\d{2})\s*$/;

export function syntheticRecords(
  pages: ReadonlyArray<{ readonly pageNumber: number; readonly text: string }>,
): { results: DocumentIntelligenceStructuredResult[]; documentDate: string | null } {
  const results: DocumentIntelligenceStructuredResult[] = [];
  let documentDate: string | null = null;
  for (const page of pages) {
    for (const line of page.text.replaceAll("\r\n", "\n").split("\n")) {
      const date = datePattern.exec(line);
      if (date !== null) documentDate = date[1] ?? null;
      const parts = line.split("|");
      if (parts[0] !== "RECORD" || parts.length < 3) continue;
      const [, kind, label, detail = "-"] = parts;
      if (kind === undefined || label === undefined || !kinds.has(kind)) continue;
      results.push({
        resultKey: `record-${results.length + 1}-${kind.replaceAll("_", "-")}`,
        type: kind as DocumentIntelligenceStructuredResult["type"],
        label,
        value: detail === "-" ? null : detail,
        unit: null,
        code: null,
        lab: null,
        specimen: null,
        date: documentDate,
        status: "informational",
        confidence: 0.9,
        source: { pageNumber: page.pageNumber, fragment: line },
      });
    }
  }
  return { results, documentDate };
}
