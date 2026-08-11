CREATE TABLE service_metadata (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO service_metadata (key, value)
VALUES ('foundation_version', '1');
