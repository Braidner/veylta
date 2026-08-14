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

Delivered in the Task 6 implementation: the document contract adds a tenant-scoped
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
| Repeat upload creates no second active document | Same-profile lifecycle integration and browser deduplication tests |
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

## Task 17 — Source-first profile overview

Commit intent: `feat: add source-first profile overview`

- `profile-overview/v1` returns one authorized profile plus at most three recent
  immutable sources, three sources awaiting final review, and three explicitly
  confirmed observations.
- Review counts include only facts without a final decision; the displayed
  `needsAttention` count remains distinct from all pending facts.
- The overview is a safe `GET`, returns `no-store`, uses the existing
  owner/self/granted-read profile boundary, and produces the same non-disclosing
  `404` outside that boundary.
- Each successful read records only `profile.overview.opened` with its contract
  version. It logs no medical value, fragment, filename, storage key, or cursor.
- The web landing view makes pending review the next visible action and keeps
  documents and confirmed values linked to their source. It deliberately does
  not show a health score, clinical state, diagnosis, or recommendation.

## Task 18 — Local synthetic evidence snapshot

Commit intent: `feat: export local synthetic evidence bundle`

- `synthetic-evidence-bundle/v1` produces a local TAR with a
  manifest and no more than five latest immutable sources. Archive paths are
  generated from document IDs; user filenames remain authorized manifest data,
  never filesystem selectors or storage keys.
- Each archive entry is rechecked against its stored SHA-256, byte size, and
  content type. An inconsistency fails closed before a bundle is returned.
- Only an owner or self-linked adult can read the route. A `profile.read` grant
  is intentionally insufficient; inaccessible selectors remain non-disclosing.
- The download is `private, no-store`, attachment-only, and payload-free
  audited as `profile.evidence_bundle.exported` with the contract marker only.
- This is a synthetic, bounded local snapshot — not a backup, restore format,
  account export, or production portability feature.

## Task 19 — Offline synthetic evidence verification

Commit intent: `feat: verify local synthetic evidence bundle`

- A dependency-free local command reads a Task 18 TAR without extracting its
  contents or calling an API.
- It fail-closes on malformed USTAR headers, duplicate/traversal entries,
  unbounded archive/manifest/source data, wrong content signatures, or a
  checksum/size mismatch.
- It validates the narrow `synthetic-evidence-bundle/v1` and
  `synthetic-profile-export/v1` shapes and prints safe aggregate counts, never
  profile data, filenames, extracted values, or source bytes. It establishes
  local structural consistency, not cryptographic origin or clinical
  correctness, and is not import, restore, or backup.

## Task 20 — Evidence-backed profile summary

Commit intent: `feat: add evidence-backed profile summary`

- `health-summary/v1` is created atomically only when the last final decision
  completes an extraction run. It snapshots at most 50 confirmed observations;
  rejected facts and unreviewed extraction proposals cannot enter it.
- A version retains its predecessor and marks every evidence item as new or
  carried forward. Summary rows and their evidence links are immutable.
- The response exposes only evidence, bounded missing-context labels, and the
  operational actions `prepare_source_for_clinician` and
  `complete_pending_review`. It has no diagnosis, risk, red-flag, trend, or
  treatment-advice field.
- The safe, profile-authorized read is `private, no-store`, re-authorizes every
  source path on follow-up, and records payload-free opened/generated audits.

## Task 21 — Immutable summary version history

Commit intent: `feat: browse immutable summary versions`

- `health-summary-history/v1` is a `private, no-store`, profile-authorized,
  newest-first index over existing immutable `HealthSummary` rows. It exposes
  only the version selector, creation time, and bounded evidence counts.
- `GET health-summary?version=N` reopens exactly version `N`; an unavailable
  version is a non-disclosing `404`. The version index uses `beforeVersion` and
  a 1–50 page size, with no write or schema change.
- Each current or historical summary read re-authorizes follow-up source links.
  The index writes its own payload-free audit event and carries neither source
  values nor any computed comparison.
- The UI selects a version explicitly and labels its immutable source snapshot.
  It does not call the prior/newer version a trend, a change, or a recommendation.

## Task 22 — Immutable summary source-set comparison

Commit intent: `feat: compare immutable summary source sets`

- `health-summary-comparison/v1` accepts two ordered existing versions and
  returns only source observations newly included in the target or no longer
  included from the base. It has no numeric delta, clinical label, trend,
  recommendation, or write path.
- The read is `private, no-store`, uses the same owner/self/granted
  `profile.read` boundary, re-authorizes each follow-up source path, fails
  closed for missing versions, and records a payload-free comparison audit.
- The UI opens the comparison only on an explicit action and labels it as a
  source-membership view rather than a health assessment.

## Task 23 — Complete local synthetic profile export

Commit intent: `feat: export complete synthetic profile archive`

- `synthetic-profile-export/v1` is a separate owner/self-authorized TAR for
  every current immutable source document and confirmed observation of one
  profile; generated archive paths never expose a storage key.
- It verifies source bytes against immutable checksum/size/content-type metadata
  and records only a payload-free contract marker audit. `profile.read` remains
  insufficient and inaccessible selectors are non-disclosing.
- The export is explicitly capped at ten synthetic sources. Above that it fails
  with no archive or audit event instead of silently omitting older records.
- The local verifier recognizes both TAR contracts without extracting them.
  This is still neither restore, deletion, backup, nor production portability.

## Task 24 — Reversible profile archive

Commit intent: `feat: archive profiles without deleting evidence`

- `profile-archive/v1` lets only an owner archive a non-last active profile
  behind the trusted-Origin mutation gate and an explicit inline confirmation.
- Archive sets only `patient_profiles.archived_at`; it immediately removes the
  profile from active session/list access, makes direct document reads
  non-disclosing, and stops the worker from claiming or persisting output for
  its source versions. It keeps original documents, blobs, facts,
  observations, jobs, and audit history intact.
- The owner-only archive list returns archived profile identity and timestamp
  and supports restore. Restore clears only `archived_at`; durable pending work
  can resume without copying or rewriting evidence. Archive/list/restore are
  payload-free audited.
- It is deliberately neither account deletion, data-retention policy, backup,
  recovery, nor production restore. Integration and Chromium tests cover
  Origin/owner/last-profile/non-disclosure boundaries, source hiding,
  worker pause/resume, and UI confirmation/restore.

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

## PWA and user-owned vault transition

Superseded by Task 30 and ADR 0007. Tasks 25–28 remain historical delivered
experiments; their browser-owned vault is not the target data authority.

ADR 0006 establishes the next implementation sequence. Each item is a separate
TDD task and commit; the SQLite reference path is retained until its vault-backed
replacement passes equivalent acceptance tests.

### Task 25 — Portable vault contract

Commit intent: `docs: adopt user-owned vault and connected agent`

- Versioned `veylta-vault/v1` root and immutable document manifest.
- Versioned, closed `veylta-agent/v1` command selectors.
- Provider-neutral folder layout, integrity/conflict rules, egress disclosure,
  and no credentials in portable data.

### Task 26 — Installable offline PWA shell

Commit intent: `feat: make veylta installable offline`

- Web app manifest, icons, standalone presentation, safe offline shell, update
  state, and capability disclosure.
- No caching of medical API responses or document bodies by the service worker.
- Desktop/mobile installability and offline-navigation browser tests.

### Task 27 — User-selected directory vault

Commit intent: `feat: initialize user-owned veylta vault`

- `VaultAdapter` with strict directory capability detection and permission
  recovery.
- Initialize/read `vault.json`; import one immutable synthetic source through a
  temporary write, SHA-256 verification, and create-only finalization.
- Explicit unsupported-browser state; no silent OPFS/IndexedDB data fallback.

### Task 28 — Installable connected-agent bridge

Commit intent: `feat: connect veylta document agent`

Delivered in the local bridge slice:

- Installable skill, loopback-only random-token bridge, durable command journal,
  long polling, expiring leases, interruption recovery, and visible status.
- `scan_unprocessed` and one checksum-bound `analyze_document` command only.
- A PWA action enqueues only `scan_unprocessed` and explicitly says no source is
  sent at that point. The skill must name the exact checksum-bound source and
  disclose Codex model egress before a later `analyze_document` command.

### Task 29 — Vault-backed review and history

Commit intent: `feat: review vault-backed agent results`

- Strict result schema and immutable runs tied to exact source SHA-256.
- Existing confirm/correct/reject boundary persisted in the vault.
- Health cockpit and observation history read from the vault adapter; SQLite is
  no longer needed for the migrated single-user path.

## Home-server PWA transition

ADR 0007 restores the tested SQLite/object-storage runtime as the target home
service and keeps the installable PWA shell. Each item remains a separate TDD
task and commit.

### Task 30 — First administrator and local sign-in

Commit intent: `feat: bootstrap the home server administrator`

- Empty-installation `account/v1` setup status and exact-Origin bootstrap.
- One atomic administrator, home workspace, linked profile, opaque session, and
  payload-free audit graph protected by SQLite constraints/transaction locking.
- Versioned scrypt password storage, uniform credential failures, sign-out and
  later username/password sign-in; legacy demo registration test-only.

### Task 31 — System settings and account administration

Commit intent: `feat: add home server settings`

- Admin-only settings shell and account lifecycle for `admin`/`user`.
- Codex CLI/app-server capability and login status through a non-secret adapter.
- Current storage location plus guarded, checksummed relocation workflow.
- Delivered with non-disclosing user access, retained verified recovery copy,
  payload-free runtime audit, and a shared API/worker `StorageController`.

### Task 32 — Profile URLs and access policy

Commit intent: `feat: enforce home profile access`

- Stable profile link and server-side authorization for administrator, linked
  owner, or explicit revocable grant only.
- No inherited read/write access from merely knowing a URL or sharing a family.
- An administrator receives owner membership and their own linked card first;
  a regular user receives only self or explicit `profile.read` access.
- Multi-account integration and browser tests cover direct-link non-disclosure.

### Task 33a — Household care plan foundation

Commit intent: `feat: add household care plan`

- Reference-informed body/status infographic and a visible evidence-state model.
- Separate visible sections for analyses, clinician specialties, nutrition,
  activity, and reminders, with person-authored dated actions persisted in
  SQLite and protected by the profile access boundary.
- `home-care-plan/v1` distinguishes user decisions from Codex proposals;
  the latter cannot exist without an immutable health-summary selector, rule
  version, and disclosed missing context.
- No opaque score, diagnosis, treatment, false urgency, or silent conversion of
  a proposal into an accepted plan item.

### Task 33b — Codex-proposed home actions

Commit intent: `feat: draft care actions with codex`

Status: delivered.

- Explicit administrator-configured Codex OAuth/runtime connection with no API
  key or copied token in Veylta.
- Profile owner asks for a draft; the exact confirmed projection fields and
  ChatGPT egress are disclosed before the run, and output is constrained to the
  five existing plan lanes.
- Every draft remains `proposed` until a person accepts or dismisses it. Each
  proposal retains summary/source provenance, model/rule version, and missing
  context; medical diagnosis, treatment, triage, and fabricated certainty are
  rejected before persistence.
- The exact summary/model/rule result replays from SQLite without a second
  Codex call. The adapter uses an empty temporary directory, read-only sandbox,
  ephemeral session, closed output schema, and disabled shell/browser/plugins.

### Task 34 — Codex document intelligence and batch intake

Commit intent: `feat: analyze document batches with codex`

Status: delivered.

- Up to twenty PDF/PNG/JPEG files can be selected or dropped in one dialog;
  every file retains its own size/signature/SHA-256/idempotency boundary.
- The dialog explicitly identifies Codex model-service egress. Originals remain
  immutable in household storage.
- `DocumentIntelligenceProvider` separates semantic analysis from storage and
  byte transport. The delivered Codex adapter classifies into a closed archive
  category and extracts only exact-fragment-bound quantitative facts.
- Non-laboratory documents complete with zero facts; malformed or invented
  provider output fails closed. Classification is immutable and versioned by
  provider, model, runtime, and schema.

### Task 35 — Immutable document reanalysis

Commit intent: `feat: restart document analysis`

Status: delivered.

- An owner can explicitly restart a terminal Codex analysis from document
  detail with an exact-Origin, idempotent command.
- Restart creates a fresh job, extraction run, facts, and intelligence result;
  it never overwrites the original object, older runs, review decisions, or
  confirmed observations.
- Status, overview, facts, and review actions select the latest run
  deterministically, while prior provenance remains retained for later run
  history UX.

### Task 36 — Persistent Codex document dialogue

Commit intent: `feat: add codex document agent runtime`

Status: delivered backend boundary.

- One local, append-only Russian conversation is bound to an exact authorized
  document and resumes the same Codex thread without copying OAuth tokens or
  requiring an API key.
- During each turn Codex receives a fresh short-lived bearer capability and a
  single read-only `get_document_context` MCP tool. The capability is scoped to
  the current actor/family/profile/document and is revoked when the CLI exits.
- The MCP route rejects browser `Origin`, arbitrary document selectors, direct
  SQLite/filesystem access, and unauthenticated calls. Shell, browser, plugins,
  memories, apps, collaboration, computer use, and image generation remain
  disabled in the Codex process.
- Messages and model/runtime provenance are persisted locally; exact-key
  replays return the stored exchange without another model call. Audit events
  contain only the contract version, never the dialogue or medical payload.
- The first dialogue boundary is read-only: Codex may explain missing context
  and accept corrections conversationally, but cannot confirm a fact or mutate
  a document. Explicit action tools remain a separate human-confirmed task.

### Task 37 — Honest document processing activity

Commit intent: `feat: expose document processing activity`

Status: delivered backend boundary.

- Every real queue, worker claim, processing stage, saved result, scheduled
  retry, and terminal failure appends one immutable closed-code event.
- `document/v4` returns the ordered journal for the latest job with only event
  code, attempt number, and timestamp. It never exposes source text, medical
  values, model output, prompts, raw exceptions, or chain-of-thought.
- The browser may poll and render these persisted events; it must not invent
  intermediate activity or imitate token streaming.

### Task 38 — Document dialogue and activity interface

Commit intent: `feat(web): add codex document activity`

Status: delivered.

- Render the persisted Russian conversation beside the source-first review.
- Render the append-only processing journal while work is active and after a
  reload, using ordinary status updates rather than fake character streaming.
- Disclose Codex model-service egress before the first message, keep the source
  text visually distinct, and show bounded pending/error/replay states.
- The first interface uses React state and ordinary HTTP polling only; no chat
  component dependency, LangGraph runtime, fake token stream, or chain-of-thought
  display is introduced.

### Task 39 — Universal document intelligence

Commit intent: `feat: add universal document intelligence`

Status: delivered.

- One bounded Codex invocation returns a Russian short summary, Russian detailed
  summary, closed classification, and source-provenanced structured results.
- Results can represent a measurement, genetic variant, finding, procedure,
  medication, diagnosis stated by the source, or a bounded `other` fallback.
- Each result carries an explicit source-derived status, optional code/unit/
  laboratory/specimen/date, confidence, page, and exact source fragment.
- Existing quantitative laboratory facts still use the human review and
  Observation path; generic results are document analytics, not silently
  confirmed longitudinal records.
- The immutable v2 intelligence row stores a bounded normalized local search
  projection. No separate model call or external search service is introduced.

### Task 40 — Searchable document lifecycle and workspace

Commit intent: `feat: manage searchable documents`

Status: delivered.

- The profile archive searches the latest authorized summaries and structured
  results with Unicode normalization performed in Node.js.
- A repeated active SHA-256 in the same profile reuses the existing logical
  document and job; another profile can retain a separate logical record while
  the family blob remains physically deduplicated.
- Authorized download returns the checksum-verified original bytes with a safe
  UTF-8 `Content-Disposition` using the stored display filename.
- Trusted-Origin, idempotent deletion tombstones the logical document and hides
  it from active metadata, content, processing, agent, overview, and search
  reads. It retains immutable provenance and does not claim physical backup
  erasure.
- The document route uses a dense responsive dashboard: short summary and
  structured results are primary; detailed summary, source integrity,
  processing activity, conversation, review, restart, download, and deletion
  remain clearly separated.

## Later MVP slices

Each item requires its own design, tests, security review, license check, and
commit chain:

1. Alternate synthetic fixtures and any OCR language/model expansion beyond the
   delivered local English PDF/image fallback.
2. Additional document-intelligence providers implementing the delivered port.
3. Clinically reviewed evidence summaries and recommendations beyond the
   delivered non-clinical `health-summary/v1` snapshot.
4. Broader role/consent UX: additional capability sets, expiry, delegation, and
   production identity. Task 15 delivers only local adult/caregiver invitation
   plus a single owner-issued `profile.read` grant.
5. Portable export, controlled deletion, backup, and verified restore.
6. FHIR R4 mappings and Bundle import/export at the system edge.

The complete MVP is not part of the first vertical slice. External OCR,
clinical advice, and real-data readiness remain off until their production
gates are met.
