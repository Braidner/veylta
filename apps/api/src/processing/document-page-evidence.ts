import type { Queryable } from "../database/pool.js";

export interface DocumentVersionScope {
  readonly familyId: string;
  readonly documentVersionId: string;
}

interface PageCitation {
  readonly source: { readonly pageNumber: number };
}

/** As much of an analysis as the citation rule needs: what each pass bound to which page. */
export interface CitingAnalysis {
  readonly extraction: { readonly items: readonly PageCitation[] };
  readonly intelligence?: { readonly structuredResults: readonly PageCitation[] };
}

/**
 * The pages one analysis read something from. Every fact and every structured result cites the
 * page it was read on, so the union of those page numbers is what the analysis stands on.
 */
export function pagesReadByAnalysis(analysis: CitingAnalysis): ReadonlySet<number> {
  const read = new Set<number>();
  for (const item of analysis.extraction.items) read.add(item.source.pageNumber);
  for (const result of analysis.intelligence?.structuredResults ?? []) {
    read.add(result.source.pageNumber);
  }
  return read;
}

/**
 * The pages of one document version something verified has already been read from: a fact of
 * any run bound to the page row, an observation standing on one, a clinician record confirmed
 * off that page. Their provenance is fixed — the stored text has to keep holding the fragments
 * they cite — so neither the second vision pass nor the page writer may touch those pages. It
 * is one rule, read here once and used by both, rather than a condition each states its own way.
 */
export async function pagesAlreadyRead(
  client: Queryable,
  scope: DocumentVersionScope,
): Promise<ReadonlySet<number>> {
  const rows = await client.query<{ page_number: number }>(
    `SELECT p.page_number
       FROM document_pages p
      WHERE p.family_id = $1
        AND p.document_version_id = $2
        AND (
          EXISTS (
            SELECT 1
              FROM extracted_facts f
             WHERE f.family_id = p.family_id
               AND f.document_version_id = p.document_version_id
               AND f.document_page_id = p.id
          )
          OR EXISTS (
            SELECT 1
              FROM observations o
             WHERE o.family_id = p.family_id
               AND o.document_version_id = p.document_version_id
               AND o.document_page_id = p.id
          )
          OR EXISTS (
            SELECT 1
              FROM clinician_records r
             WHERE r.family_id = p.family_id
               AND r.document_version_id = p.document_version_id
               AND r.page_number = p.page_number
          )
        )`,
    [scope.familyId, scope.documentVersionId],
  );
  return new Set(rows.rows.map((row) => Number(row.page_number)));
}
