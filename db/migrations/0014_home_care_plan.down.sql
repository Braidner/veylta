CREATE TABLE care_plan_items_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO care_plan_items_rollback_guard (allowed)
SELECT 0 WHERE EXISTS (SELECT 1 FROM care_plan_items);

DROP TABLE care_plan_items_rollback_guard;
DROP TRIGGER care_plan_items_delete_forbidden;
DROP TRIGGER care_plan_items_state_transition_required;
DROP TRIGGER care_plan_items_content_immutable;
DROP TRIGGER care_plan_items_source_in_summary_required;
DROP TRIGGER care_plan_items_missing_context_shape_required;
DROP INDEX care_plan_items_rule_proposal;
DROP INDEX care_plan_items_profile_state_schedule;
DROP TABLE care_plan_items;
DROP INDEX observations_family_profile_identity;
