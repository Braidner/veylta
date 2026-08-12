# Architecture

## Decision summary

Veylta uses a small TypeScript monorepo with three deployable processes:
a Next.js web application, a Fastify API, and a worker. Embedded SQLite through
Node.js `node:sqlite` stores domain state, explicit schema migrations, audit
events, and—beginning with Task 5—durable idempotent jobs. Original documents
live behind versioned `ObjectStorage/v1`; the first adapter uses a persistent
local filesystem directory.

The first vertical slice uses a deterministic, versioned parser for one
synthetic PDF format with a text layer. It does not invoke OCR, an LLM, or a
cloud service. S3, OCR, and LLM providers remain adapter-level future work.

## System context

```mermaid
flowchart LR
  U["Authenticated user"] --> W["Next.js web"]
  W -->|"tenant-scoped /v1 API"| A["Fastify API"]
  A --> P[("SQLite file")]
  A --> O["ObjectStorage/v1"]
  J["Worker"] --> P
  J --> O
  O --> L["Persistent local filesystem"]
  A -. "future adapter" .-> S["S3-compatible storage"]
  J -. "future, owner opt-in" .-> X["OCR / LLM providers"]
```

The browser never accesses the database or a storage path directly. The API
resolves the authenticated actor, checks family/profile scope server-side, and
then proxies authorized document downloads. Resource IDs are selectors, never
proof of authorization.

## Repository boundaries

The intended minimal layout is:

```text
apps/
  web/       # UI and browser integration; no medical domain rules
  api/       # Fastify HTTP entry, worker entry, and shared domain services
packages/
  contracts/ # versioned HTTP and extraction schemas
db/
  migrations/ # ordered, explicit SQLite migrations and rollback files
docs/
```

The API and worker are separate runtime entries from the same `apps/api`
artifact. No separate worker workspace or Nx/Turbo-style orchestration is
required. Shared code is extracted only when two real consumers need it.

## Runtime responsibilities

### Web

- Makes the active family member/profile unmistakable.
- Through Task 4, supports family/profile creation, document upload, immutable
  metadata, duplicate disclosure, and authorized source download.
- Later tasks add real processing state, review, correction/confirmation, and
  indicator history rather than simulating those stages in the client.
- Treats API errors and authorization failures as data, with no domain state
  transitions hidden in React components.

### API

- Authenticates the actor and enforces tenant/profile authorization per request.
- Validates request schemas, MIME/type, size, state transitions, and ownership.
- Streams uploads through hashing and storage; never buffers a whole document.
- Through Task 4, creates document/idempotency rows and audit events
  transactionally. Task 5 adds durable jobs.
- Proxies local document reads after authorization.

### Worker

- Through Task 4, exposes liveness/readiness and verifies SQLite access only.
- Task 5 adds polling and claims for SQLite-backed jobs with bounded leases and
  retry counters.
- It then executes idempotent processing steps, records each attempt/error, and
  extracts text and facts for the supported deterministic format.
- It does not create a confirmed `Observation`; only a user review can do that
  in the first slice.
- Exhausted Task 5 work moves to a visible dead-letter state.

### SQLite

- Is the source of truth for structured state and, from Task 5, local job
  coordination. The default file is `.local/veylta.sqlite`.
- Uses the SQLite runtime built into Node.js; no database server, container, ORM,
  or additional runtime package is required.
- Enables foreign keys, a 5-second busy timeout, WAL journaling, and
  `synchronous=NORMAL` on every application connection.
- Serializes operations inside each process and starts write transactions with
  `BEGIN IMMEDIATE`, so concurrent writers resolve before domain work proceeds.
- Uses ordered SQL migrations checked into source control. Every migration is
  reversible or includes an explicit, tested rollback procedure.
- Enforces tenant keys, foreign keys, uniqueness/idempotency keys, and valid
  status values in addition to application validation.

This is a local, single-host boundary. Multi-host API/worker replicas and high
write concurrency require a separate persistence ADR rather than placing the
SQLite file on a shared network filesystem.

## Upload and extraction flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant S as ObjectStorage/v1 local
  participant D as SQLite
  participant W as Worker

  B->>A: POST synthetic PDF for patient profile
  A->>A: Authenticate, authorize, validate limits/signature
  A->>S: putStream(staging key) while calculating SHA-256
  A->>D: BEGIN IMMEDIATE; recheck idempotency/blob
  A->>S: Finalize deterministic immutable tenant-scoped blob
  A->>D: Insert document/version + audit + idempotency; COMMIT
  A-->>B: 202 uploaded / processing not_started / possible duplicate
  Note over W,D: Task 5 begins here
  A->>D: Create idempotent extraction job
  W->>D: Claim durable job lease
  W->>S: getStream(document version)
  W->>W: Extract text + deterministic lab-extraction/v1 parse
  W->>D: Transaction: pages + extraction run + extracted facts
  B->>A: Confirm or correct fact with idempotency key
  A->>D: Transaction: observation + reference + review + audit
  B->>A: GET indicator history and authorized source
```

The storage/database boundary cannot provide a single distributed transaction.
Task 4 therefore stages and validates the stream, enters an SQLite
`BEGIN IMMEDIATE` write transaction, rechecks request/blob state, finalizes the
stream under a deterministic tenant/checksum key, verifies immutable metadata,
and only then inserts the document/version/idempotency/audit rows and commits. A
rollback can leave an inaccessible final orphan, but cannot leave committed
metadata pointing to unavailable bytes. Retrying the same content safely reuses
the final object. Automated orphan retention and permanent deletion are
separate confirmed workflows and remain deferred.

## Idempotency and consistency

- Upload request idempotency is scoped by family and actor.
- Duplicate detection uses `(family_id, sha256)` so one tenant cannot learn that
  another tenant already has identical bytes.
- Each job has a stable deduplication key, step name, attempt count, lease,
  retry schedule, and terminal `dead_letter` state.
- Extraction output is unique by extraction run, parser version, source
  location, and fact key.
- Observation creation is unique per reviewed extracted fact. A repeated
  confirmation returns the existing result or a deterministic conflict.
- Medical rows and their audit event commit in one database transaction.
- State transitions are compare-and-set operations; retries cannot move a newer
  state backward.

## Document storage boundary

`ObjectStorage/v1` provides streaming writes, bounded verified reads, existence,
metadata, size, content type, checksum, and an explicit deletion primitive
reachable only from a separate confirmed deletion workflow. Task 4 streams
uploads, but a controlled read takes a checksum-verified in-memory snapshot of
at most 5 MiB so the returned bytes are exactly the bytes that were verified.
Original `DocumentVersion` content is immutable after finalization.

The local adapter stores opaque keys derived from trusted identifiers/checksum,
not user filenames, under a configured persistent root. Reads cannot escape
that root. The API proxies downloads for the first slice. S3-compatible storage,
provider-side encryption, and short-lived presigned URLs are deferred to the
next storage slice and must satisfy the same contract tests.

## Medical data boundary

`ExtractedFact` records untrusted parser output and provenance. It is never an
asserted clinical fact. Human review creates an immutable `Observation` that
retains source value/unit separately from any normalized value/unit. Unit
conversion is a versioned, reproducible operation and never overwrites source
data. See [ADR 0003](adr/0003-medical-data-model.md).

## Authentication and tenant isolation

The authentication mechanism may evolve, but every request must resolve a
server-side `actorUserId`. Authorization then checks:

1. active `FamilyMembership` and role;
2. requested `familyId` matches the resource's family;
3. the actor owns the profile or has a valid `ConsentGrant` for the capability;
4. the operation is allowed in the current resource state.

Queries include the authorized family boundary at their root. Cross-family and
otherwise inaccessible resource IDs return `404` to avoid existence disclosure.
Audit records contain actor, tenant, action, resource identifier, result, and
time, but not document bodies or medical values.

## Observability

- Structured logs use request/job correlation IDs and redact bodies, extracted
  text, medical values, filenames, credentials, and signed links.
- Metrics report counts, durations, retries, dead-letter jobs, and state ages
  without patient labels or medical payloads.
- Traces propagate correlation metadata, never document content.
- Extraction/agent runs retain version, parameters, timing, and status. Future
  paid providers also record cost, but not secrets.

## Evolution boundaries

- Add an S3 adapter without changing domain code or HTTP semantics.
- Add OCR behind a versioned provider contract only after document security
  checks and explicit owner egress configuration.
- Add LLM providers behind independent adapters; route all inputs/outputs through
  deterministic pre/post safety rules and strict versioned schemas.
- Add FHIR R4 mapping at import/export edges. The internal model remains compact
  and FHIR-inspired rather than depending on a heavy FHIR platform.

## Deployment and readiness

The first slice is a synthetic, local-development demonstration. Production use
with real medical data additionally requires completed secret management,
transport and disk encryption, malware strategy, rate/size limits, backup and
restore testing, controlled export/deletion, incident response, privacy review,
and independent security/legal audits. No compliance claim follows from this
architecture.
