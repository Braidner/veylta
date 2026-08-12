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

The product path is: owner → family/profile → synthetic text-PDF → immutable
local document → deterministic extracted facts → explicit review → confirmed
observation → history/source.

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
- Streamed bounded PDF upload with signature/type validation and SHA-256.
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
review decisions and their optional observations; Task 7 history remains
pending.

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

### Task 7 — Indicator history and authorized source (pending)

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
| Confirmed value appears in history | Task 7 pending: history API + browser E2E |
| Source is authorized | Download and cross-family negative tests |
| Failure makes no partial observation | Transaction fault-injection test |
| Retry creates no duplicates | Concurrent/replay job test |
| No external OCR/LLM | Adapter absence/disabled-network assertion |
| Only synthetic fixtures | Fixture inventory and log/telemetry assertion |
| CI quality and license gates pass | Recorded CI/local command output |

## Later MVP slices

Each item requires its own design, tests, security review, license check, and
commit chain:

1. S3-compatible `ObjectStorage/v1` adapter, encryption configuration, and
   short-lived authorized delivery.
2. JPEG/PNG and scanned-PDF OCR fallback, beginning with a reviewed local
   permissive engine and trained-data license inventory.
3. Broader classification/extraction with provider interfaces and strict schemas.
4. Comparable indicator chart and deterministic trend recalculation.
5. Evidence-backed versioned summary and carefully bounded recommendations.
6. Full role/consent UX and audit-log view.
7. Portable export, controlled deletion, backup, and verified restore.
8. FHIR R4 mappings and Bundle import/export at the system edge.

The complete MVP is not part of the first vertical slice. External OCR/LLM,
clinical advice, and real-data readiness remain off until their production gates
are met.
