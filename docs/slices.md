# Vertical slice plan

## Delivery rules

- Work red → green → refactor: begin with the smallest failing regression or
  acceptance test, implement only enough behavior, then simplify.
- Keep one completed task in one meaningful commit. Do not mix unrelated cleanup
  or defer its tests to a later commit.
- A task is complete only when its scoped lint, typecheck, tests, migration, docs,
  and license checks pass.
- Use only synthetic medical documents and values.
- Do not mark a deferred stage or provider as implemented.

## First vertical slice

The product path is: owner → family/profile → synthetic PDF/PNG/JPEG →
immutable local document → deterministic extracted facts → explicit review →
confirmed observation → history/source.

### Task 1 — Product, architecture, safety, and license foundation

Commit intent: `docs: establish product architecture and license boundaries`

- MIT license and honest project README.
- Product/architecture/threat model.
- ADRs for Fastify/system boundaries, storage, medical model, and agent safety.
- Logical ER model, `v1` API contract, slice plan, and license policy.
- Explicitly identify S3, OCR, LLM, and full-MVP work as deferred.

No package manifest, runtime code, migration, or implementation claim belongs in
this task.

### Task 2 — Runnable TypeScript foundation

Commit intent: `chore: bootstrap runnable TypeScript workspace`

- pnpm workspaces: `apps/web`, `apps/api`, `packages/contracts`.
- Next.js web; Fastify HTTP entry and separate worker entry in `apps/api`.
- Embedded `node:sqlite` database, persistent local path, environment example,
  health checks, and explicit up/down migration and isolated test harness.
- Baseline strict TypeScript, lint, unit/integration/E2E harness, CI, and
  dependency-license gate.
- Verify and update README commands with actual output.

No family or medical behavior beyond a health/readiness path.

### Task 3 — Tenant-scoped family profile

Commit intent: `feat: create tenant-scoped family profiles`

- Begin with integration tests for owner creation and cross-family denial.
- Minimal authenticated synthetic/demo request context suitable for tests/local
  development; never trust a caller-supplied user ID.
- Atomic local-only demo onboarding with an opaque hashed session, strict
  cookie/origin boundary, and no email/password collection.
- Migrations for user, family, membership, patient profile, and audit event.
- Owner-only family/profile API plus the smallest usable URL-authoritative
  profile UI; adult/caregiver consent remains fail-closed and deferred.
- Server-side default-deny authorization and non-disclosing missing response.

### Task 4 — Immutable local document upload

Commit intent: `feat: persist immutable documents with sha256 deduplication`

- Reusable `ObjectStorage/v1` contract tests and local adapter.
- Streamed bounded document upload with signature/type validation and SHA-256.
- Persistent original, safe authorized proxy download, and restart test.
- Family-scoped possible-duplicate response, no automatic deletion, no second
  blob, and negative cross-family duplicate/disclosure tests.
- Staging/finalization recovery and upload/download audit events.

### Task 5 — Idempotent deterministic extraction

Commit intent: `feat: extract synthetic lab facts idempotently`

- SQLite-backed jobs with stable dedupe key, lease, retry schedule, attempt
  limit, and visible dead-letter state.
- Existing separate worker runtime entry in `apps/api`, polling the shared local
  SQLite database. Before this task it performs readiness checks only.
- PDF text-layer extraction and narrow deterministic parser for the checked-in,
  clearly synthetic fixture format.
- Strict `lab-extraction/v1` schema, parser version, page/source fragment,
  confidence, validation issues, and `needs_review` routing.
- Fault/retry tests prove no duplicate page, run, or fact rows and no network
  call to OCR/LLM.

Delivered in `feat: extract synthetic lab facts idempotently`: the upload
transaction queues the SQLite job; the separate worker claims it with a lease,
stores page/run/fact provenance atomically, and presents `awaiting_review` or a
sanitized retryable terminal failure. The fixture is a checked-in synthetic
text-PDF, parsed by PDF.js plus a narrow `lab-extraction/v1` grammar. The public
processing/facts reads and failed-job retry are tenant-scoped. Task 6 delivers
review decisions and their optional observations; Task 7 presents those
confirmed observations as profile-wide history.

### Task 6 — Review and atomic observation confirmation

Commit intent: `feat: review and confirm extracted observations`

- API and UI tests begin with source-first explicit review for every extracted
  fact, with extra warning treatment for low-confidence/ambiguous-unit facts.
- Side-by-side source fragment and proposed fields; confirm, correct, or reject.
- Raw fact remains immutable when corrected.
- Transactional decision + observation + source reference/range + audit event.
- Idempotency, stale-version, rollback, and cross-family tests.

Delivered in the Task 6 implementation: `document/v3` adds a tenant-scoped
fact-review command requiring exact `Origin` and `Idempotency-Key`. It accepts
`factVersion` plus `confirm`, `correct`, or `reject`; correction fields are
required only for `correct`. The UI keeps source evidence and proposed values
separate and offers explicit source-first decisions. The transaction writes one
immutable `ReviewDecision`, an idempotency request, a payload-free audit event,
and, for confirmation/correction, one `Observation` plus an optional
source-specific range. Rejection creates no observation; raw facts are never
edited. The public facts read derives confirmed/rejected status, and the run
becomes `completed` only after every fact has its final decision.

### Task 7 — Indicator history and authorized source

Commit intent: `feat: show observation history with its source`

- History API/UI for confirmed observations with source and normalized fields
  clearly distinguished.
- Dates, unit, document-specific reference, laboratory flag, confidence, reviewer,
  page, fragment, and authorized document link.
- Cross-family negative tests for history and source content.
- Browser E2E covers family → profile → upload → review → confirmation → history
  → source.

A table is sufficient for the first point. A chart becomes meaningful with a
later comparable-observation task and must not imply analysis from one result.

Delivered in `feat: show observation history with its source`:
`observation-history/v1` reads only tenant- and profile-authorized immutable
confirmed observations. It preserves a correction's confirmed source
name/value/unit without changing the raw extracted fact, keeps optional
normalized data distinct, and carries document-specific range, date, reviewer,
confidence, page, fragment, and a relative source-document path. The API uses a
strict optional canonical-code filter and opaque pagination cursor; every
successful history read is payload-free audited. The profile UI is source-first
and re-authorizes the original PDF on download. Integration and browser tests
cover pagination, correction, rejection absence, and cross-family denial.

### Task 8 — Acceptance evidence

Commit intent: `docs: record first-slice acceptance evidence`

- Record exact commands and passing results for lint, typecheck, unit,
  integration, E2E, migrations, and license checks.
- Verify persistence after process restart, same-family duplicate behavior,
  cross-family isolation, retry idempotency, dead-letter visibility, and atomic
  rollback by test or documented fault injection.
- List deferred behavior and known limitations without calling the slice
  production-ready.

Any code fix found during acceptance is its own tested task/commit before the
evidence commit.

Delivered in
[`docs: record first-slice acceptance evidence`](first-slice-acceptance.md):
the durable record identifies the implementation commits, exact locally run
gate results, test counts, acceptance-to-test mapping, migration verification,
MIT boundary, and explicit synthetic/local/non-production limitations. It does
not claim a remote CI run or production readiness.

## First-slice executable acceptance matrix

| Requirement | Primary evidence |
| --- | --- |
| One documented startup sequence | Clean local/CI startup smoke test |
| Original survives restart | Integration test with persistent local volume |
| Repeat upload is a possible duplicate | Same-family upload integration test |
| No cross-family duplicate oracle | Two-family negative integration test |
| Page-level provenance | Extraction schema/DB/API assertions |
| Uncertain fact requires review | Domain + UI tests |
| Correction preserves raw extraction | Database/API assertion |
| Confirmed value appears in history | `observation-history/v1` integration + browser E2E |
| Source is authorized | Download and cross-family negative tests |
| Failure makes no partial observation | Transaction fault-injection test |
| Retry creates no duplicates | Concurrent/replay job test |
| No external OCR/LLM | Adapter absence/disabled-network assertion |
| Only synthetic fixtures | Fixture inventory and log/telemetry assertion |
| CI quality and license gates pass | Recorded CI/local command output |

## Task 9 — Comparable indicator catalog and chart

Commit intent: `feat: compare compatible confirmed indicators`

- The deterministic parser assigns canonical codes only to its two explicit
  synthetic analytes; unknown facts remain unclassified rather than being
  guessed into a clinical vocabulary.
- Tenant- and profile-authorized `indicator-series/v1` catalog and detail reads
  are payload-free audited and never expose a cross-family indicator oracle.
- A catalog keeps each exact source unit separate. A series permits one known
  canonical code plus one exact unit; no unit conversion, reference-range
  inference, or clinical interpretation occurs.
- The detail response has keyset pagination, source-first timeline items, and
  an explicit comparison state. The arithmetic difference uses exact decimal
  parsing only; nonnumeric source values fail closed to an unavailable state.
- The profile UI shows the compact accessible line chart only when there are at
  least two finite numeric source values. The timeline and re-authorized source
  links remain the authoritative detailed view, and copy states that the chart
  is not a reference range or health assessment.

Delivered in `feat: compare compatible confirmed indicators`: the catalog and
chart work only for confirmed, compatible synthetic observations. Corrections
remain immutable source-first observations; a second unit creates a distinct
row rather than a mixed comparison. Tests cover the two-value path, pagination,
separate units, unknown codes, audit events, tenant denial, and browser flow.

## Task 10 — Optional S3-compatible immutable storage

Commit intent: `feat: add encrypted S3-compatible object storage`

- Adds an exact-version Apache-2.0 AWS SDK v3 S3 client behind existing
  `ObjectStorage/v1`; domain and HTTP APIs remain provider-agnostic.
- `OBJECT_STORAGE_DRIVER=s3` is an explicit opt-in. It requires bucket, region,
  opaque prefix, and SSE-S3 or SSE-KMS configuration; local storage remains the
  default.
- Object paths use a digest of the trusted port key. Staging, metadata sealing,
  conditional immutable finalize, and controlled bounded checksum reads uphold
  the same contract as the local adapter.
- The API continues to proxy a freshly authorized download. No presigned URL,
  provider credential endpoint, retention worker, cloud account test, or
  real-data approval is claimed.

Delivered in `feat: add encrypted S3-compatible object storage`: reusable
contract tests run the S3 adapter against a deterministic protocol fake and
cover staging, restart, concurrency, cleanup, size cap, opaque keys, encryption
attestation, and altered-byte rejection. The provider network remains opt-in
and credentials are left to the SDK's external server-side provider chain.

## Task 11 — Local synthetic scanned-PDF OCR fallback

Commit intent: `feat: add local synthetic OCR fallback`

- Text-layer extraction remains the first path. Only its explicit
  `TEXT_LAYER_MISSING` result may enter this fallback; malformed, oversized, or
  otherwise unsupported PDFs never do.
- The worker renders at most three PDF pages, caps each page at two million
  pixels and the job at four million pixels, and limits rendered PNG and OCR
  output sizes. It then invokes the exact local English Tesseract package with
  no provider URL, no cache write, and a bounded timeout.
- OCR output is accepted only if it satisfies the same strict synthetic fixture
  header and fact grammar as a text-layer PDF. It is never treated as a medical
  observation without the existing review flow.
- Direct JPEG/PNG ingestion, language/model selection, cloud OCR, provider
  configuration, real-document support, and browser exposure remained out of
  scope for this task.

Delivered in `feat: add local synthetic OCR fallback`: unit and integration
tests prove a bounded image-only synthetic PDF reaches the existing immutable
page/fact provenance path, that a non-missing text-extraction error cannot call
OCR, and that local recognition makes no network request. Provenance records
the local OCR method/version. Exact engine, trained-data, renderer, and install
script policy are reviewed under the MIT boundary.

## Task 16 — Direct synthetic PNG/JPEG ingestion

Commit intent: `feat: add direct synthetic image ingestion`

- Extends the immutable upload contract from PDF-only to `application/pdf`,
  `image/png`, and `image/jpeg`, sharing the existing 5 MiB streaming,
  SHA-256, same-family deduplication, safe-download, and authorization path.
- Validates exact magic bytes before staging. PNG/JPEG inputs are additionally
  preflighted with a bounded header parser before decode, then pass through the
  existing local English OCR and the exact synthetic fact grammar.
- SQLite migration `0010_direct_image_documents` records the true immutable
  content type without changing historic PDF rows; rollback refuses to discard
  image provenance.
- Integration and browser tests cover direct PNG and JPEG ingestion, MIME
  mismatch rejection, pixel caps, provenance, no-network OCR, and type-correct
  source download. This is still a synthetic demo convention, not a technical
  detector for real medical content.

## Task 12 — Owner-only payload-free audit log

Commit intent: `feat: add owner-only family audit log`

- `audit-log/v1` projects only existing event id/action/result/time plus actor
  and resource selectors; metadata, correlation IDs, filenames, text, and
  medical values remain internal.
- Owner-only family authorization, strict query parsing, opaque keyset cursor,
  private response caching, and a payload-free read audit are covered by
  integration tests.
- The profile UI places a compact, paginated activity log in the owner rail,
  with loading, empty, error, and mobile layouts.

## Task 13 — Local one-time adult invitation

Commit intent: `feat: add local one-time adult invitations`

- An active owner can issue one high-entropy, SHA-256-stored, 24-hour
  `family-invitation/v1` code in the loopback synthetic demo.
- Accepting it atomically makes a new `adult_member`, linked adult profile, and
  HttpOnly session; replay and expiry are non-disclosing.
- A joined adult can see and use only that personal linked profile. No caregiver
  capability, family-wide profile access, or consent grant is implied.
- Integration, migration, and browser tests cover one-time consumption, expiry,
  CSRF origin gate, owner-only issuance, and the self-profile boundary.

## Task 14 — Explicit revocable profile read grant

Commit intent: `feat: add explicit profile read consent`

- An active owner can grant and revoke the single `profile.read` capability for
  one active invited adult and one active profile through `profile-consent/v1`.
- Grant evaluation is server-side on every profile/document/history/indicator
  read; session state carries the visible access label but never caches authority.
- The capability excludes upload, retry, extracted-fact review, invitation,
  audit-log, and caregiver powers. A one-way revoke returns the same
  non-disclosing boundary as an unknown resource.
- SQLite constraints/triggers, integration tests, and a two-session browser
  scenario cover owner-only lifecycle, cross-family denial, one-time revoke,
  and absence of write access.

## Task 15 — Local caregiver invitation and explicit read access

Commit intent: `feat: add local caregiver read access`

- `family-invitation/v2` extends the loopback synthetic invitation only with
  `caregiver`; accepting it creates an active caregiver session but never a
  self-linked profile.
- `profile-consent/v2` permits the existing singular `profile.read` capability
  for an active invited adult or caregiver. Both roles remain default-deny and
  write-denied for every other profile.
- SQLite triggers prevent caregiver linkage to an adult profile; rollback
  fails closed while caregiver records exist rather than deleting them.
- A two-session browser scenario proves the caregiver sees no profile name
  before the owner grants access, then only the shared read-only profile, and
  returns to the empty state after revocation.

## Later MVP slices

Each item requires its own design, tests, security review, license check, and
commit chain:

1. Alternate synthetic fixtures and any OCR language/model expansion beyond the
   delivered local English PDF/image fallback.
2. Broader classification/extraction with provider interfaces and strict schemas.
3. Evidence-backed versioned summary and carefully bounded recommendations.
4. Broader role/consent UX: additional capability sets, expiry, delegation, and
   production identity. Task 15 delivers only local adult/caregiver invitation
   plus a single owner-issued `profile.read` grant.
5. Portable export, controlled deletion, backup, and verified restore.
6. FHIR R4 mappings and Bundle import/export at the system edge.

The complete MVP is not part of the first vertical slice. External OCR/LLM,
clinical advice, and real-data readiness remain off until their production gates
are met.
