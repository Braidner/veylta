-- Rolling this migration back and re-applying it re-derives every handle, including the ones a person chose.
DROP INDEX IF EXISTS patient_profiles_handle_unique;
ALTER TABLE patient_profiles DROP COLUMN handle_set_by;
ALTER TABLE patient_profiles DROP COLUMN handle;
