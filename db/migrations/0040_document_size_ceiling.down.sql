-- Narrowing the bound back to 5 MB would make a larger recorded source unrepresentable, and a
-- source is never dropped to make a rollback succeed. This guard aborts the whole migration —
-- migrateDown runs it in one transaction — while any recorded byte count exceeds the old bound.
CREATE TABLE document_size_ceiling_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO document_size_ceiling_rollback_guard (allowed)
SELECT 0
 WHERE EXISTS (SELECT 1 FROM document_blobs WHERE byte_size > 5242880)
    OR EXISTS (SELECT 1 FROM document_upload_requests WHERE request_byte_size > 5242880)
    OR EXISTS (SELECT 1 FROM document_upload_reuse_requests WHERE request_byte_size > 5242880);

DROP TABLE document_size_ceiling_rollback_guard;

-- The exact inverse of the up migration; see it for why the bound is edited in place.
PRAGMA writable_schema = ON;

UPDATE sqlite_master
   SET sql = replace(sql, 'BETWEEN 5 AND 104857600', 'BETWEEN 5 AND 5242880')
 WHERE type = 'table'
   AND name IN (
     'document_blobs',
     'document_upload_requests',
     'document_upload_reuse_requests'
   );

PRAGMA writable_schema = RESET;

-- Reads the edit back and moves the schema cookie, as the up migration does.
CREATE TABLE document_size_ceiling_guard (
  applied INTEGER NOT NULL CHECK (applied = 1)
);

INSERT INTO document_size_ceiling_guard (applied)
SELECT 0
  FROM sqlite_master
 WHERE type = 'table'
   AND name IN (
     'document_blobs',
     'document_upload_requests',
     'document_upload_reuse_requests'
   )
   AND sql NOT LIKE '%BETWEEN 5 AND 5242880%';

DROP TABLE document_size_ceiling_guard;
