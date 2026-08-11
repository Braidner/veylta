DROP TABLE audit_events;
DROP TABLE patient_profiles;
ALTER TABLE families DROP CONSTRAINT IF EXISTS families_creator_membership_fk;
DROP TABLE family_memberships;
DROP TABLE families;
DROP TABLE sessions;
DROP TABLE users;
