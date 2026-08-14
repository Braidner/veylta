CREATE TABLE processing_activity_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 0)
);

INSERT INTO processing_activity_rollback_guard (allowed)
SELECT 1 WHERE EXISTS (SELECT 1 FROM processing_job_events);

DROP TABLE processing_activity_rollback_guard;

DROP TRIGGER processing_job_events_delete_forbidden;
DROP TRIGGER processing_job_events_update_forbidden;
DROP INDEX processing_job_events_timeline;
DROP TABLE processing_job_events;
