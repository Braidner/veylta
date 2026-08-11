# ADR 0002: Versioned document storage boundary

- Status: Accepted
- Date: 2026-08-11

## Context

Original medical documents are primary evidence. They must be streamed, hashed,
immutable after acceptance, recoverable across restarts, and retrievable only
after tenant authorization. Development needs local storage; production is
expected to use an S3-compatible service without coupling domain logic to one
vendor.

## Decision

Define a versioned `ObjectStorage/v1` port with operations for:

- streaming upload to a staging object and atomic finalization;
- streaming download;
- existence and metadata lookup;
- trusted content type, size, SHA-256, and provider metadata;
- deletion as a low-level capability callable only by a separate, confirmed
  deletion workflow.

The first adapter is a persistent local filesystem root. Object keys are opaque,
tenant-scoped trusted identifiers/checksums and never use a user-supplied path or
filename. The adapter enforces containment under its configured root and the API
proxies downloads after authorization.

Each accepted upload creates an immutable `DocumentVersion`. SHA-256 is computed
while streaming. Possible duplicates are detected only inside the same family,
shown to the user, and never automatically deleted. Database and storage cannot
share a transaction, so staging/finalization state and repairable failures are
explicit.

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

## Deferred work

- S3-compatible adapter, server-side encryption configuration, and short-lived
  presigned URLs.
- Explicit backup/restore and export manifests.
- Confirmed retention/deletion workflow and orphan cleanup automation.
- JPEG/PNG handling and OCR-related derived artifacts.

None is represented as implemented by the first local/text-PDF slice.

## Rejected alternatives

- **Database BLOBs:** couple large immutable bytes to transactional backups and
  make streaming/provider migration harder.
- **Direct filesystem calls from routes/jobs:** bypass contract tests and spread
  path/security logic.
- **Global checksum deduplication:** leaks cross-tenant document equality.
- **Immediate duplicate deletion:** contradicts source-first behavior and can
  destroy a legitimately separate record.
- **S3 first:** increases credentials/network/test complexity before the domain
  path is proven.
