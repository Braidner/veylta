/**
 * The overview's document query: one document per row with its first version, blob, latest
 * job, latest extraction run, latest intelligence and the fact/review counts of that run.
 * `recentDocuments` reads every active document; the review queue reads only those whose
 * latest run awaits review. Parameters: `$1` family id, `$2` profile id.
 */
export function overviewDocumentsSql(options: {
  readonly onlyAwaitingReview: boolean;
  readonly limit: number;
}): string {
  const runJoin = options.onlyAwaitingReview
    ? `JOIN extraction_runs r
         ON r.id = (
           SELECT latest_run.id
             FROM extraction_runs latest_run
            WHERE latest_run.family_id = d.family_id
              AND latest_run.document_version_id = v.id
            ORDER BY latest_run.created_at DESC, latest_run.id DESC
            LIMIT 1
         )
        AND r.status = 'awaiting_review'`
    : `LEFT JOIN extraction_runs r
         ON r.id = (
           SELECT latest_run.id
             FROM extraction_runs latest_run
            WHERE latest_run.family_id = d.family_id
              AND latest_run.document_version_id = v.id
            ORDER BY latest_run.created_at DESC, latest_run.id DESC
            LIMIT 1
         )`;
  return `SELECT d.id,
                 d.family_id,
                 d.patient_profile_id,
                 d.status,
                 d.original_filename,
                 d.uploaded_at,
                 duplicate.id AS duplicate_of_document_id,
                 duplicate.patient_profile_id AS duplicate_profile_id,
                 COALESCE(blob_type.content_type, b.content_type) AS content_type,
                 b.byte_size,
                 b.sha256,
                 b.storage_key,
                 v.id AS document_version_id,
                 j.id AS job_id,
                 j.state AS job_state,
                 j.current_stage AS job_current_stage,
                 j.last_error_code AS job_last_error_code,
                 j.updated_at AS job_updated_at,
                 r.id AS extraction_run_id,
                 r.status AS extraction_status,
                 intelligence.provider AS intelligence_provider,
                 intelligence.model_id AS intelligence_model_id,
                 intelligence.runtime_version AS intelligence_runtime_version,
                 intelligence.schema_version AS intelligence_schema_version,
                 intelligence.category AS intelligence_category,
                 intelligence.title AS intelligence_title,
                 intelligence.short_summary AS intelligence_short_summary,
                 intelligence.document_date AS intelligence_document_date,
                 intelligence.confidence AS intelligence_confidence,
                 COUNT(f.id) AS fact_count,
                 COALESCE(SUM(CASE WHEN d_review.id IS NULL AND f.id IS NOT NULL THEN 1 ELSE 0 END), 0)
                   AS pending_fact_count,
                 COALESCE(SUM(CASE
                   WHEN d_review.id IS NULL AND f.review_status = 'needs_review' THEN 1
                   ELSE 0
                 END), 0) AS needs_attention_fact_count
            FROM documents d
            JOIN document_versions v
              ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
            JOIN document_blobs b
              ON b.family_id = v.family_id AND b.id = v.blob_id
            LEFT JOIN document_blob_content_types blob_type
              ON blob_type.family_id = b.family_id AND blob_type.blob_id = b.id
            LEFT JOIN documents duplicate
              ON duplicate.family_id = d.family_id AND duplicate.id = d.duplicate_of_document_id
             AND duplicate.deleted_at IS NULL
            LEFT JOIN processing_jobs j
              ON j.id = (
                SELECT latest_job.id
                  FROM processing_jobs latest_job
                 WHERE latest_job.family_id = d.family_id
                   AND latest_job.document_version_id = v.id
                   AND latest_job.kind = 'document_extraction'
                 ORDER BY latest_job.created_at DESC, latest_job.id DESC
                 LIMIT 1
              )
            ${runJoin}
            LEFT JOIN document_intelligence_results intelligence
              ON intelligence.id = (
                SELECT latest_intelligence.id
                  FROM document_intelligence_results latest_intelligence
                 WHERE latest_intelligence.family_id = d.family_id
                   AND latest_intelligence.document_version_id = v.id
                 ORDER BY latest_intelligence.created_at DESC, latest_intelligence.id DESC
                 LIMIT 1
              )
            LEFT JOIN extracted_facts f
              ON f.family_id = r.family_id AND f.extraction_run_id = r.id
            LEFT JOIN review_decisions d_review
              ON d_review.family_id = f.family_id AND d_review.extracted_fact_id = f.id
           WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.deleted_at IS NULL
           GROUP BY d.id, d.family_id, d.patient_profile_id, d.status, d.original_filename,
                    d.uploaded_at, duplicate.id, duplicate.patient_profile_id,
                    blob_type.content_type, b.content_type, b.byte_size, b.sha256, b.storage_key,
                    v.id, j.id, j.state, j.current_stage, j.last_error_code, j.updated_at,
                    r.id, r.status, intelligence.provider, intelligence.model_id,
                    intelligence.runtime_version, intelligence.schema_version,
                    intelligence.category, intelligence.title, intelligence.short_summary,
                    intelligence.document_date, intelligence.confidence
           ORDER BY d.uploaded_at DESC, d.id DESC
           LIMIT ${options.limit}`;
}
