# ADR 0002: Versioned document storage boundary

- Status: Accepted
- Date: 2026-08-11
- Amended 2026-08-20: the 5 MiB figure below is the bound as decided. The per-document
  cap is now `MAX_SYNTHETIC_DOCUMENT_BYTES` (100 MB) in
  `packages/contracts/src/document-size.ts`, which every source-side bound reads —
  including the snapshot a controlled read verifies. The decision itself is unchanged:
  one bound, enforced while streaming, with reads verified against it.

## Context

Original medical documents are primary evidence. They must be streamed, hashed,
immutable after acceptance, recoverable across restarts, and retrievable only
after tenant authorization. Development needs local storage; production is
expected to use an S3-compatible service without coupling domain logic to one
vendor.

## Decision

Define a versioned `ObjectStorage/v1` port with operations for:

- streaming upload to a staging object and atomic finalization;
- controlled, bounded download with metadata bound to the verified bytes;
- existence and metadata lookup;
- trusted content type, size, SHA-256, and provider metadata;
- deletion as a low-level capability callable only by a separate, confirmed
  deletion workflow.

The default adapter is a persistent local filesystem root. Object keys are
opaque, tenant-scoped trusted identifiers/checksums and never use a
user-supplied path or filename. The adapter enforces containment under its
configured root and the API proxies downloads after authorization.

The local adapter bounds accepted synthetic documents to 5 MiB and returns controlled
reads from a checksum-verified byte snapshot. This deliberately spends at most
the upload cap in memory on download so a local same-inode write cannot change
the bytes between verification and response. A future large-object adapter must
provide an equivalent integrity guarantee without relying on this bounded
snapshot.

Each accepted upload creates an immutable `DocumentVersion` that references a
family-scoped physical blob. SHA-256 is computed while streaming. Possible
duplicates are detected only inside the same family, shown to the user, and
never automatically deleted.

Database and storage cannot share a transaction. Task 4 therefore stages and
validates the stream before entering an SQLite `BEGIN IMMEDIATE` transaction.
Inside that write transaction it rechecks idempotency/blob state, finalizes the
deterministic tenant/checksum key, verifies the result, and commits metadata and
audit rows afterward. A rollback may leave an inaccessible final orphan, but
never a committed document whose bytes are unavailable. A retry safely reuses
the immutable object. Bounded automated orphan cleanup remains deferred until a
retention workflow exists.

## Consequences

### Positive

- Domain and API behavior do not depend on filesystem or S3 SDK details.
- The same reusable contract tests can validate every adapter.
- Streaming bounds memory usage and establishes a single checksum source.
- Tenant-scoped deduplication avoids a cross-family checksum oracle.
- Immutable versions preserve evidence and provenance.

### Negative

- Staged/orphaned blobs require a bounded cleanup/reconciliation process.
- The local adapter lacks provider-side encryption and presigned URLs; production
  must supply disk encryption and an appropriate delivery mechanism.
- Content-address-like keys can expose equality to a storage operator, so family
  scope and storage access controls remain necessary.
- Finalizing local storage while an SQLite write transaction is open increases
  write-lock time; the bounded 5 MiB local upload keeps this trade-off explicit.

## S3-compatible adapter

Task 10 adds an optional S3-compatible implementation of the same port. It is
selected only by `OBJECT_STORAGE_DRIVER=s3`; local storage remains the default.
The adapter derives provider object names and key-binding metadata from a digest
of the already opaque port key, so the plaintext family/checksum key is not sent
to S3 as an object path or provider metadata.
It writes first to a staged object, seals trusted content type/size/SHA-256 port
metadata, and copies to the final key with conditional `If-None-Match: *`.
Finalization treats a conditional race as an already-existing immutable object,
not an overwrite.

Every PUT/COPY requires either SSE-S3 (`AES256`) or SSE-KMS (`aws:kms` plus a
configured key identifier), and HEAD/GET responses must attest to that exact
setting. Controlled reads pin the provider ETag, require port metadata to match
the database expectation, then retain and SHA-256 verify a snapshot bounded by
the current 5 MiB contract before returning it. This keeps the proven
same-bytes-read guarantee rather than assuming an S3 ETag is a SHA-256 digest.

The SDK uses its standard server-side credential provider chain. Application
configuration has no access-key fields, and `.env.example` deliberately omits
credentials. Operators must provide least-privilege credentials, bucket policy
enforcement, TLS, key policy/rotation, logging redaction, and lifecycle policy
outside the repository. The checked-in contract suite uses an in-memory S3
protocol fake; no cloud account, real provider endpoint, or real medical data
was used to validate this slice.

## Deferred work

- Short-lived presigned URLs. Downloads remain API-proxied and freshly
  authorized.
- Explicit backup/restore and export manifests.
- Confirmed retention/deletion workflow and orphan cleanup automation.
- OCR language/model expansion, alternate grammar formats, and derived
  artifacts beyond the bounded direct image support.

None is represented as implemented by the first local document slice.

## Rejected alternatives

- **Database BLOBs:** couple large immutable bytes to transactional backups and
  make streaming/provider migration harder.
- **Direct filesystem calls from routes/jobs:** bypass contract tests and spread
  path/security logic.
- **Global checksum deduplication:** leaks cross-tenant document equality.
- **Immediate duplicate deletion:** contradicts source-first behavior and can
  destroy a legitimately separate record.
- **S3 first:** increased credentials/network/test complexity before the domain
  path was proven. It is now a bounded optional adapter after the local path and
  reusable contract tests were established.
