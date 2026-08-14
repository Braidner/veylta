# Threat model

## Scope and status

This model covers the planned local first slice and the boundaries required
before any real medical document is accepted. The first slice is restricted to
fully synthetic data. Controls described as a production gate are requirements,
not claims about current implementation or regulatory compliance.

## Assets

- Original documents and derived page text.
- Extracted facts, confirmed observations, reference ranges, and summaries.
- Family/profile relationships and consent grants.
- Authentication credentials, sessions, provider credentials, and encryption
  keys.
- Audit history, processing/job history, backups, and exports.
- Availability and integrity of the API, worker, local SQLite database, and
  object storage.

Medical data is highly sensitive. A resource identifier, checksum, filename,
processing state, or fact that a document exists can itself be sensitive.

The target PWA architecture places custody on one household server. That reduces
third-party custody but does not make the data automatically encrypted or safe
to expose. Host accounts, filesystem permissions, home-network access, remote
access configuration, storage relocation, and backups are part of the threat
boundary.

## Trust boundaries

1. Browser to Fastify API over an authenticated transport.
2. API/worker to the configured local SQLite database file.
3. API/worker to `ObjectStorage/v1` and the configured local storage root or,
   only when explicitly selected, an S3-compatible TLS endpoint.
4. Untrusted document bytes/text to security checks and bounded local transport.
5. Explicit deployment to S3 or an external OCR/provider network.
6. Operators, logs, metrics, traces, backups, and exported files.
7. Browser/PWA to local account bootstrap, sign-in, and settings surfaces.
8. API to the optional local Codex CLI adapter.
9. Codex CLI to the model service for bounded acknowledged document pages or a
   confirmed care-plan projection. Home storage does not remove this egress.

All document content and metadata supplied by a user are untrusted. Extracted
text is data, never an instruction. A configured external provider is not inside
the family's trust boundary merely because it exposes an API.

## Threat actors and failure modes

- An authenticated member trying to access another family or an ungranted
  profile.
- An unauthenticated remote user or stolen session.
- A malicious or malformed uploaded file exploiting validation/parser/storage.
- A compromised dependency, provider, deployment secret, or operator account.
- Accidental disclosure through logs, telemetry, errors, backups, URLs, or test
  fixtures.
- Retry, race, or partial-failure bugs corrupting medical history.
- Confirmed source fields attempting prompt injection against the Codex job.

## Threats and required controls

| Threat | Impact | Required control | Delivery gate |
| --- | --- | --- | --- |
| IDOR/cross-family query | Disclosure or modification of another tenant's data | Resolve actor server-side; scope every query by authorized family/profile; test two families; return non-disclosing `404` | First slice |
| Implicit family-wide access | Adult/caregiver sees an ungranted profile | Separate membership from profile consent; fixed `profile.read` grants; default deny | Local adult/caregiver read grant in synthetic demo; full roles before real data |
| Duplicate checksum oracle | Confirms another family has a document | Deduplicate and report matches only within `family_id`; no global match response | First slice |
| Duplicate logical upload | Repeated source creates conflicting analyses and review work | For the same active family/profile/SHA-256, return the existing logical document and record an immutable idempotent reuse request; retain separate profile scope | Document lifecycle |
| Search-query disclosure | Medical terms leak through logs or audit metadata | Normalize and search locally after profile authorization; bound query length; never place the raw query, summaries, or result values in logs/audit | Document intelligence v2 |
| Misleading deletion | UI promises erasure while provenance or backups retain data | Tombstone only after write authorization, trusted Origin, and an idempotency key; remove the source from every active read; explicitly distinguish archive removal from physical/backup erasure | Document lifecycle |
| Stale/revoked consent | Continued access after permission changes | Check the grant in every read query; one-way revoke; do not cache capability in the session; audit grant lifecycle | Synthetic demo read grant; expiry and broader lifecycle before real data |
| Invitation-code theft or replay | Unintended local demo membership | Disable legacy demo registration on LAN; exact trusted Origin; high-entropy one-time SHA-256-hashed code; 24-hour expiry; atomic consume; active-owner issuance; payload-free audit | Synthetic local demo only |
| Session theft/CSRF | Account takeover or state-changing request | Secure, HttpOnly, SameSite session cookies or equivalent bearer protections; exact trusted-browser-origin allowlist with no wildcard/subnet entries; CSRF defense where cookies are used; rotation and logout | Before real data |
| MIME/extension spoofing | Unsafe parser input | Allowlist PDF/JPEG/PNG, inspect exact magic bytes, reject mismatch, set bounded size/page/count/pixel limits | Bounded subset in first slice |
| Malformed PDF/image/parser/OCR exploit | Code execution, crash, or data disclosure | Bounded PDF.js text-layer extraction; for text-layer-missing PDFs only, a local rendered-page OCR path with a 5 MiB document cap, at most 3 pages, 2 million pixels/page, 4 million pixels total, 8 MiB PNG/page, timeout, strict synthetic grammar, controlled byte snapshot, security updates, and adversarial tests. Direct PNG/JPEG has exact signature plus header pixel-cap preflight before decode. Process isolation remains required before real data | Bounded subset in first slice; isolation hardening before real data |
| Path traversal/symlink race | Read/write outside storage root | Ignore user filename for keys; canonical root containment; safe permissions; atomic creation; reject links | First slice |
| Upload memory/disk exhaustion | Denial of service | Stream with byte limit; quotas/rate limits; staging cleanup; disk monitoring; reject early | Stream/size in first slice; quotas before real data |
| Malware in accepted document | Harm when viewed/exported | Quarantine/security-check state, safe content disposition/viewer, production malware strategy isolated behind reviewed boundary | Strategy and implementation before real data |
| Partial upload/database failure | Orphaned blob or document that cannot be read | Stage and atomically finalize before metadata commit; deterministic retry recovery; never claim success early; add bounded orphan cleanup before real data | Retry-safe local and S3-compatible path; cleanup before real data |
| Original mutation | Loss of evidence/provenance | Immutable version keys; stored SHA-256 and size; verify checksum on controlled reads/backup restore | First slice |
| Storage overwrite/tampering | Original evidence silently changes or is read inconsistently | Opaque key digest; S3 conditional create; required/attested SSE-S3 or SSE-KMS; ETag-pinned controlled read; bounded SHA-256 snapshot checked against database metadata | Adapter contract tests; provider IAM/bucket/key policies before any real data |
| Job retry/race | Duplicate or contradictory medical records | Stable job dedupe key; leased claims; compare-and-set transitions; immutable retry/review requests; DB uniqueness; transactional fact persistence and final review | Extraction and review controls in first slice |
| Poisoned extraction | Incorrect value presented as truth | `ExtractedFact` is untrusted and separate from `Observation`; strict schema; confidence/review gate; preserve raw value | First slice |
| Prompt injection | Codex follows instructions embedded in documents or confirmed source fields | Send bounded structured content explicitly labelled untrusted; fixed policy; empty temporary directory; ephemeral/read-only run; disable tools, rules, plugins, memories, browser, shell, and collaboration; strict schema; exact-fragment post-validation | Codex document intelligence and household plan |
| Unsafe medical output | Diagnosis/treatment harm or missed urgency | Codex can only select one bounded draft per existing lane; deterministic copy contains no diagnosis, treatment, triage, prescription, or urgency. Each item remains `proposed`, with immutable run/summary/model/rule/source/context provenance and explicit acceptance | Codex household plan |
| Assistant impersonation | Conversational UI is mistaken for a doctor, nutritionist, or trainer | Use role labels `Медицинский навигатор`, `Питание`, and `Движение`; state that they do not replace a professional; derive landing messages from server-authoritative state; route every action to an implemented source/review/plan surface; never show an opaque health score | Profile landing UI |
| Provider egress without consent | Sensitive document sent externally | The batch dialog names Codex and requires literal acknowledgement before upload. The provider receives bounded page content but no family/profile IDs, filename, storage key, path, or credentials. The UI discloses ChatGPT egress first | Codex document intelligence |
| Bootstrap race or second administrator | Attacker claims or duplicates the first account | Expose setup only while no account exists; serialize with `BEGIN IMMEDIATE`; create account/workspace/profile/session atomically; exact-Origin mutation | Home-server bootstrap |
| Weak local password storage | Offline database theft reveals credentials | Versioned memory-hard scrypt hash with random salt; password-length bounds; uniform login failure; no password in audit/logs | Home-server bootstrap |
| Unsafe storage relocation | Partial copy or typed-path mistake loses evidence | Admin-only maintenance mode; copy and checksum every object; atomically switch configuration only after verification; retain recovery journal | Before configurable relocation |
| Codex credential disclosure | Home app copies subscription tokens into its database/logs | Never read or persist Codex OAuth; start/connect to local app-server; store only non-secret preferences and status | First Codex adapter |
| Unauthorized local agent | Another process submits work or broadens scope | Profile ACL and trusted Origin; empty temporary cwd; ephemeral/read-only Codex; shell, browser, plugins, memory, collaboration, computer/image tools disabled; closed schema; no arbitrary command surface | Codex household plan |
| Document-agent scope escalation | Codex or another local process asks MCP for another family's document | Random per-turn bearer capability; token hashed in memory; exact actor/family/profile/document scope derived server-side; no selectors in tool input; fresh write authorization on every call; browser Origin rejected; route bound to the loopback API | Codex document dialogue |
| Dialogue data in logs/audit | Medical corrections appear in operational records | Message text stays only in the local dialogue tables and Codex request; audit is payload-free and version-only; runtime errors are sanitized | Codex document dialogue |
| Agent mutates medical truth | A model confirms a fact or restarts processing without the person understanding | Task 36 MCP surface is read-only and contains only `get_document_context`; confirmation, correction, and restart remain existing explicit user actions | Codex document dialogue |
| Misleading local-storage claim | User assumes model processing never leaves device | Before upload, identify Codex as the processor and disclose model-service egress under the user's Codex data controls; distinguish local immutable storage from provider processing | First Codex adapter |
| SSRF through URL/provider config | Access to internal network or cloud metadata | No arbitrary URL ingest in first slice; allowlisted endpoints; URL parsing, DNS/IP checks, redirect limits, egress policy | Before URL/provider features |
| Signed-link leakage | Temporary public access to a document | API still proxies authorized reads; later presigned URLs are single-purpose, short-lived, non-logged, and tenant-bound | Before presigned URLs |
| Sensitive logs/traces | Persistent secondary disclosure | Never log bodies, text, medical values, raw filenames, tokens, or signed URLs; redact errors; no patient labels in metrics | First slice |
| Secret exposure | Provider/database compromise | Environment/secret manager, least privilege, rotation, no secret in repo/log/client image | Before real data |
| Dependency/license compromise | Code execution or prohibited distribution | Lockfile, minimal dependencies, license allowlist, vulnerability review, reproducible CI, update policy | From scaffold onward |
| Audit tampering or overcollection | No accountability or new privacy leak | Append-only semantics and restricted reads; record identifiers/action/result/time, not medical payload; integrity/retention policy | Events in first slice; hardening before real data |
| Backup loss/disclosure | Irrecoverable or leaked history | Encrypted backups, separate access, retention, checksum, documented restore drills, deletion propagation | Before real data |
| Export/account deletion bug | Incomplete portability or unintended destruction | The delivered local source snapshot is bounded to five sources; the separate local profile export includes all sources/confirmed observations only up to a ten-source cap and fails closed rather than truncating. Both use owner/self authorization, verify checksums, write payload-free audits, and have a no-extraction verifier. Verified production portability still needs deletion, grace period, and backup-retention disclosure | Full MVP, before production |

## First-slice security invariants

- Empty-installation setup collects no email, stores a versioned scrypt password
  hash, persists only a SHA-256 session-token digest, and requires an exact
  configured browser origin. The transaction creates exactly one administrator,
  workspace, linked profile, and session.
- Synthetic PDF/PNG/JPEG only; no real medical data enters the repository or demo flow.
- Every family/profile/document/fact/observation query starts from the authorized
  tenant scope, including worker queries.
- Upload is streamed, bounded, signature-checked, hashed, and stored under an
  opaque trusted key.
- Original bytes are immutable. Duplicate detection never crosses tenant
  boundaries and never automatically deletes content.
- An owner may reversibly archive a non-last profile, but archive is not
  deletion: active profile/document authorization and worker claims reject it,
  while the immutable source graph remains retained until a separately designed
  production deletion/retention workflow exists.
- Byte integrity, PDF text transport, and bounded OCR stay deterministic and
  local. Semantic classification and structured extraction run through Codex
  only after the UI egress disclosure. The response is untrusted until its
  closed schema and every exact source fragment pass local validation.
- The repository, fixtures, tests, and supported parser format are
  synthetic-only. PDF/PNG/JPEG signature/type/size checks are not content classification
  and cannot prevent a local user from selecting a real medical document; therefore
  this demo is explicitly unsuitable for real data.
- The worker accepts only the bounded, checksum-verified PDF/PNG/JPEG stored for its
  tenant-scoped document version. It extracts PDF text with PDF.js; only a
  missing PDF layer can activate rendered-page OCR, while direct image inputs
  use bounded local OCR after header validation. Codex may classify any bounded
  document into the closed category set; non-laboratory documents complete with
  zero facts, while invalid or unbound model output fails closed.
- A `dead_letter` result exposes only a safe category and retry eligibility.
  The retry command is origin-checked and idempotent; it cannot choose a parser,
  job kind, storage key, URL, OCR provider, or LLM provider.
- Raw extraction cannot become a confirmed observation without explicit review.
  `confirm`, `correct`, and `reject` require the exact configured browser
  origin and an idempotency key; a correction carries source name/value/unit
  only and never edits the extraction.
- One immutable final `ReviewDecision` is allowed per extracted fact. A
  confirmation or correction, its optional source-specific range, its review
  request, and payload-free audit event commit with the resulting observation;
  rejection commits no observation. A run becomes `completed` only when every
  fact has such a final decision.
- State changes and medical persistence are idempotent and transactional.
- Logs, tests, and audit metadata contain no document bodies or medical values.
- The processing journal contains only a closed event code, bounded attempt,
  and timestamp. It is not a model transcript: prompts, token deltas, stdout,
  chain-of-thought, extracted values, and raw errors are forbidden.
- The delivered family audit-log read is owner-only, tenant-scoped, paginated,
  and payload-free; it serializes no metadata/correlation IDs and records its
  own payload-free access event. The narrow local `profile.read` grant is
  owner-to-active-invited-adult-or-caregiver only, profile-scoped, server-checked
  per read, and revocable; all write and broader role visibility remain
  default-deny.

## Production gate for real data

Before removing the synthetic-only restriction, complete and review at least:

- full role/consent lifecycle and negative authorization test matrix;
- transport and disk encryption, secret management, session hardening, and
  deployment least privilege;
- parser isolation and malware strategy;
- quotas, rate limits, monitoring, alerting, and incident response;
- audit access/retention/integrity policy;
- backup, restore, export, controlled deletion, and disaster-recovery drills;
- privacy, security, medical-safety, dependency-license, and legal review.

This list is not a compliance checklist. No medical or legal standard is claimed
without a separate scoped audit.

## Security verification

- Integration tests use two families and attempt implemented document, fact,
  review, derived-observation, profile history, and download operations across
  the boundary. History returns only confirmed observations and the returned
  document selector is authorized again on download.
- Contract tests attempt traversal keys, mismatched MIME/signatures, oversized
  streams, interrupted writes, and checksum mismatch.
- Concurrency tests replay uploads, job claims, and fact-review commands.
- Fault injection fails before/after storage finalization and before transaction
  commit, proving no partial observation is created.
- Log assertions reject synthetic medical value and document body leakage.
