import { effectiveDateSql } from "./document-date.js";

export interface TimelineRow {
  id: string;
  original_filename: string;
  uploaded_at: string;
  content_type: string;
  document_date_override: string | null;
  intelligence_document_date: string | null;
  category: string | null;
  title: string | null;
  short_summary: string | null;
  effective_date: string;
}

/**
 * Reviewed documents only — the latest job succeeded, the latest run completed and no fact of
 * that run waits for a decision — strictly before `$3` (null: no bound), restricted to the `$4`
 * most recent days that carry one. `$1` family id, `$2` profile id. Newest day first, newest
 * upload first within a day. Ask for one day more than the page needs: that extra day says
 * whether an older page exists, and the caller drops its entries.
 *
 * The `NOT EXISTS` clause is the SQL twin of `isInDocumentQueue` in
 * `packages/contracts/src/document-timeline.ts`: a document is reviewed here exactly when the
 * queue there no longer holds it. Change one and the other must follow, or the queue and the
 * timeline would disagree about the same document.
 */
export const timelineEntriesSql = `WITH reviewed AS (
  SELECT d.id,
         d.original_filename,
         d.uploaded_at,
         COALESCE(blob_type.content_type, b.content_type) AS content_type,
         d.document_date_override,
         intelligence.document_date AS intelligence_document_date,
         intelligence.category,
         intelligence.title,
         intelligence.short_summary,
         ${effectiveDateSql("d", "intelligence")} AS effective_date
    FROM documents d
    JOIN document_versions v
      ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
    JOIN document_blobs b
      ON b.family_id = v.family_id AND b.id = v.blob_id
    LEFT JOIN document_blob_content_types blob_type
      ON blob_type.family_id = b.family_id AND blob_type.blob_id = b.id
    JOIN processing_jobs j
      ON j.id = (
        SELECT latest_job.id
          FROM processing_jobs latest_job
         WHERE latest_job.family_id = d.family_id
           AND latest_job.document_version_id = v.id
           AND latest_job.kind = 'document_extraction'
         ORDER BY latest_job.created_at DESC, latest_job.id DESC
         LIMIT 1
      )
    JOIN extraction_runs r
      ON r.id = (
        SELECT latest_run.id
          FROM extraction_runs latest_run
         WHERE latest_run.family_id = d.family_id
           AND latest_run.document_version_id = v.id
         ORDER BY latest_run.created_at DESC, latest_run.id DESC
         LIMIT 1
      )
    LEFT JOIN document_intelligence_results intelligence
      ON intelligence.id = (
        SELECT latest_intelligence.id
          FROM document_intelligence_results latest_intelligence
         WHERE latest_intelligence.family_id = d.family_id
           AND latest_intelligence.document_version_id = v.id
         ORDER BY latest_intelligence.created_at DESC, latest_intelligence.id DESC
         LIMIT 1
      )
   WHERE d.family_id = $1
     AND d.patient_profile_id = $2
     AND d.deleted_at IS NULL
     AND j.state = 'succeeded'
     AND r.status = 'completed'
     AND NOT EXISTS (
       SELECT 1
         FROM extracted_facts f
         LEFT JOIN review_decisions rd
           ON rd.family_id = f.family_id AND rd.extracted_fact_id = f.id
        WHERE f.family_id = r.family_id AND f.extraction_run_id = r.id AND rd.id IS NULL
     )
),
page AS (
  SELECT * FROM reviewed WHERE ($3 IS NULL OR effective_date < $3)
),
days AS (
  SELECT DISTINCT effective_date FROM page ORDER BY effective_date DESC LIMIT $4
)
SELECT page.*
  FROM page
 WHERE page.effective_date >= (SELECT MIN(effective_date) FROM days)
 ORDER BY page.effective_date DESC, page.uploaded_at DESC, page.id DESC`;

/** Confirmed observations of the given documents with their printed range — `$1` family, `$2` profile; ids follow. */
export function observationRowsSql(documentCount: number): string {
  return `SELECT o.document_id,
                 o.source_value,
                 rr.source_low,
                 rr.source_high,
                 rr.laboratory_out_of_range
            FROM observations o
            LEFT JOIN observation_reference_ranges rr
              ON rr.family_id = o.family_id AND rr.observation_id = o.id
           WHERE o.family_id = $1 AND o.patient_profile_id = $2 AND o.status = 'confirmed'
             AND o.document_id IN (${documentPlaceholders(documentCount)})`;
}

/** Confirmed clinician records per document — same parameters. */
export function recordCountsSql(documentCount: number): string {
  return `SELECT document_id, COUNT(*) AS record_count
            FROM clinician_records
           WHERE family_id = $1 AND patient_profile_id = $2 AND decision = 'confirmed'
             AND document_id IN (${documentPlaceholders(documentCount)})
           GROUP BY document_id`;
}

/** The document ids follow family and profile, so the list starts at `$3`. */
function documentPlaceholders(documentCount: number): string {
  return Array.from({ length: documentCount }, (_, index) => `$${index + 3}`).join(", ");
}
