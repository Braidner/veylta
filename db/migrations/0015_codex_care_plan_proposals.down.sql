CREATE TABLE care_plan_codex_proposals_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO care_plan_codex_proposals_rollback_guard (allowed)
SELECT 0 WHERE EXISTS (SELECT 1 FROM care_plan_proposal_runs);

DROP TABLE care_plan_codex_proposals_rollback_guard;
DROP TRIGGER care_plan_proposal_runs_delete_forbidden;
DROP TRIGGER care_plan_proposal_runs_transition_required;
DROP TRIGGER care_plan_proposal_runs_count_required;
DROP TRIGGER care_plan_proposal_runs_identity_immutable;
DROP TRIGGER care_plan_proposal_runs_completed_immutable;
DROP TRIGGER care_plan_codex_provenance_delete_forbidden;
DROP TRIGGER care_plan_codex_provenance_update_forbidden;
DROP TRIGGER care_plan_codex_item_provenance_required;
DROP TRIGGER care_plan_codex_provenance_run_required;
DROP TABLE care_plan_codex_provenance;
DROP INDEX care_plan_proposal_runs_profile_state;
DROP TABLE care_plan_proposal_runs;
CREATE UNIQUE INDEX care_plan_items_rule_proposal
  ON care_plan_items (family_id, patient_profile_id, health_summary_id, category, rule_version)
  WHERE origin = 'codex';
