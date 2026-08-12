# Architecture

## Decision summary

Veylta uses a small TypeScript monorepo with three deployable processes:
a Next.js web application, a Fastify API, and a worker. Embedded SQLite through
Node.js `node:sqlite` stores domain state, explicit schema migrations, audit
events, and durable idempotent jobs. Original documents live behind versioned
`ObjectStorage/v1`; the default adapter uses a persistent local filesystem
directory, and an optional S3-compatible adapter preserves the same contract
for synthetic deployments.

The public document surface is `document/v3`: immutable extracted facts remain
separate from explicit, idempotent fact-review decisions. The separate read-only
`observation-history/v1` boundary exposes only those immutable observations
that were explicitly confirmed or corrected. `indicator-series/v1` is a second
read boundary that groups only the deterministic synthetic canonical codes and
requires an exact source unit before it returns a comparable series.
`audit-log/v1` is a third, owner-only and payload-free boundary: it projects
only audit action/result/time/actor/resource selectors and never exposes event
metadata or medical/document payloads.

The first vertical slice uses a deterministic, versioned parser for one
synthetic PDF format. It reads the text layer first and, only when that layer is
missing, applies a bounded local English OCR model to rendered PDF pages before
the same strict grammar check. It does not invoke an external OCR provider or
an LLM. The optional S3 adapter is a storage boundary, not document egress to
an OCR/LLM provider; it remains disabled unless explicitly configured.

## System context

```mermaid
flowchart LR
  U["Authenticated user"] --> W["Next.js web"]
  W -->|"tenant-scoped /v1 API"| A["Fastify API"]
  A --> P[("SQLite file")]
  A --> O["ObjectStorage/v1"]
  J["Worker"] --> P
  J --> O
  O --> L["Persistent local filesystem (default)"]
  O -. "explicit adapter" .-> S["S3-compatible storage (optional)"]
  J --> Q["Local bounded synthetic-PDF OCR"]
  J -. "future, owner opt-in" .-> X["External OCR / LLM providers"]
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
- Supports family/profile creation, document upload, immutable metadata,
  duplicate disclosure, authorized source download, and real processing status.
- Polls the processing endpoint while work is active and presents only a
  sanitized failure category plus an authorized retry action.
- Presents source-first fact decisions and correction/confirmation, then a
  profile-wide confirmed-observation history with source document provenance.
- Presents an authorized catalog of known synthetic indicators and, only for an
  exact code/unit series, a compact numeric chart and deterministic source-value
  difference. The timeline and source links remain available beside the chart.
- Treats API errors and authorization failures as data, with no domain state
  transitions hidden in React components.

### API

- Authenticates the actor and enforces tenant/profile authorization per request.
- Validates request schemas, MIME/type, size, state transitions, and ownership.
- Streams uploads through hashing and storage; never buffers a whole document.
- The checked-in fixture, tests, and parser format are synthetic-only. MIME,
  signature, and size checks are not a detector for real medical content, so
  local demo use remains explicitly unsuitable for real data.
- Creates document/idempotency rows and audit events transactionally, then
  creates a durable extraction job in the same upload transaction.
- Exposes tenant-scoped processing status and extracted facts; accepts a retry
  only for a terminal failed job and an explicit fact review only with exact
  `Origin` and `Idempotency-Key`.
- Reads `observation-history/v1` only after profile authorization, uses opaque
  keyset pagination, and audits the payload-free history access. The returned
  source-document path remains a relative selector: the download endpoint
  performs authorization again.
- Reads `audit-log/v1` only after an active owner check on the requested family;
  it uses opaque keyset pagination, adds one payload-free access event per
  successful page, and does not expose audit metadata or correlation IDs.
- Proxies local document reads after authorization.

### Worker

- Polls and claims SQLite-backed jobs with bounded leases and retry counters.
- Executes idempotent processing steps, records each attempt/error, and
  extracts text and facts for the supported deterministic format.
- Commits one payload-free audit outcome atomically with successful facts or a
  retry/dead-letter transition; stdout contains only a sanitized outcome.
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
  A->>D: Insert document/version + audit + idempotency + extraction job; COMMIT
  A-->>B: 202 uploaded / processing queued / possible duplicate
  W->>D: Claim durable job lease
  W->>S: getStream(document version)
  W->>W: Extract text + deterministic lab-extraction/v1 parse
  W->>D: Transaction: pages + extraction run + immutable extracted facts
  W-->>D: job succeeded; run awaiting_review
  B->>A: GET processing / facts
  Note over B,D: Task 6 review decisions create optional observations; Task 7 reads confirmed observations with re-authorized source links
```

The storage/database boundary cannot provide a single distributed transaction.
The upload path therefore stages and validates the stream, enters an SQLite
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
- Each job has a stable deduplication key, attempt count, bounded lease, retry
  schedule, and terminal `dead_letter` state. A retry request is itself
  immutable and idempotency-scoped to the family and actor.
- Extraction output is unique by extraction run, parser version, source
  location, and fact key.
- Each fact has at most one immutable `ReviewDecision`. `ReviewRequest` scopes
  an idempotency key to family and actor, so an exact replay returns the prior
  response and a conflicting reuse fails deterministically.
- `confirm` and `correct` create one confirmed `Observation` per reviewed fact;
  `reject` creates none. The decision, optional observation and source range,
  idempotency request, and audit event commit in one database transaction.
- The raw extracted fact is never changed. Once every fact in an
  `awaiting_review` run has its final decision, that run becomes `completed`.
- `observation-history/v1` reads confirmed observations only, orders by the
  deterministic sample/result/upload timeline with an ID tie-breaker, and does
  not derive clinical interpretations. `indicator-series/v1` separately admits
  only explicitly known synthetic canonical codes and one exact source unit;
  its comparison is arithmetic on the latest two finite decimal source strings,
  with an explicit insufficient/unavailable state for every other case.
- A terminal worker outcome is committed with its fact graph or failure
  transition and is not duplicated by acknowledgement replay.
- State transitions are compare-and-set operations; retries cannot move a newer
  state backward.

## Document storage boundary

`ObjectStorage/v1` provides streaming writes, bounded verified reads, existence,
metadata, size, content type, checksum, and an explicit deletion primitive
reachable only from a separate confirmed deletion workflow. The upload path streams
uploads, but a controlled read takes a checksum-verified in-memory snapshot of
at most 5 MiB so the returned bytes are exactly the bytes that were verified.
Original `DocumentVersion` content is immutable after finalization.

The local adapter stores opaque keys derived from trusted identifiers/checksum,
not user filenames, under a configured persistent root. Reads cannot escape
that root. The API proxies downloads. The optional S3-compatible adapter maps
each opaque key to a provider-side digest (including key-binding metadata),
stages before finalizing with a
conditional create, and requires/attests SSE-S3 or SSE-KMS on every stored
object. Its controlled reads pin ETag and checksum-verify a bounded snapshot
against database metadata. Short-lived presigned URLs remain deferred.

## Medical data boundary

`ExtractedFact` records untrusted parser output and provenance. It is never an
asserted clinical fact. An immutable `ReviewDecision` records the explicit
`confirm`, `correct`, or `reject` outcome without changing that evidence.
Confirmation or correction creates an immutable `Observation` that retains
source value/unit separately from any normalized value/unit; rejection creates
no observation. Unit conversion is a versioned, reproducible operation and
never overwrites source data. See [ADR 0003](adr/0003-medical-data-model.md).

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
time, but not document bodies or medical values. The worker's structured logs
contain only its processing outcome and a sanitized error category; they omit
job identifiers, filenames, text, values, and stack traces.

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
