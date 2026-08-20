-- The household may keep documents up to MAX_SYNTHETIC_DOCUMENT_BYTES (100 MB), but the byte
-- counts recorded at upload still carried the original 5 MB bound, so every larger source died
-- on a CHECK inside the accept transaction — a 500, not the 413 a size deserves.
--
-- SQLite cannot widen a CHECK in place, and the usual rebuild is not available here: three
-- tables reference document_blobs and document_upload_requests (document_versions, which is
-- itself the parent of six more tables, plus the two content-type overlays), and dropping a
-- parent that still has children raises the deferred foreign-key counter for good — the commit
-- fails even though PRAGMA foreign_key_check is clean. Rebuilding the whole island to move one
-- numeric bound would put the record itself at risk, so the bound is edited where it is stored:
-- the CHECK text in sqlite_master. No row moves and no foreign key is touched.
PRAGMA writable_schema = ON;

UPDATE sqlite_master
   SET sql = replace(sql, 'BETWEEN 5 AND 5242880', 'BETWEEN 5 AND 104857600')
 WHERE type = 'table'
   AND name IN (
     'document_blobs',
     'document_upload_requests',
     'document_upload_reuse_requests'
   );

PRAGMA writable_schema = RESET;

-- Reads back what the edit produced and aborts the migration unless every one of the three
-- tables now carries the new bound. Creating and dropping the guard is also what moves the
-- schema cookie: an edit through writable_schema leaves it untouched, and an api or worker
-- process holding an open connection would go on enforcing the old bound from its cached
-- schema until it restarted.
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
   AND sql NOT LIKE '%BETWEEN 5 AND 104857600%';

DROP TABLE document_size_ceiling_guard;
