CREATE TABLE health_summaries_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO health_summaries_rollback_guard (allowed)
SELECT 0
 WHERE EXISTS (SELECT 1 FROM health_summary_evidence)
    OR EXISTS (SELECT 1 FROM health_summaries);

DROP TABLE health_summaries_rollback_guard;

DROP TRIGGER health_summary_evidence_delete_forbidden;
DROP TRIGGER health_summary_evidence_newness_required;
DROP TRIGGER health_summary_evidence_profile_and_status_required;
DROP TRIGGER health_summary_evidence_update_forbidden;
DROP TRIGGER health_summaries_delete_forbidden;
DROP TRIGGER health_summaries_metadata_shape_required;
DROP TRIGGER health_summaries_previous_summary_required;
DROP TRIGGER health_summaries_update_forbidden;
DROP INDEX health_summary_evidence_observation;
DROP INDEX health_summaries_profile_version;
DROP TABLE health_summary_evidence;
DROP TABLE health_summaries;
