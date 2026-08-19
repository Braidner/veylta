DROP INDEX IF EXISTS patient_profiles_handle_unique;
ALTER TABLE patient_profiles DROP COLUMN handle_set_by;
ALTER TABLE patient_profiles DROP COLUMN handle;
