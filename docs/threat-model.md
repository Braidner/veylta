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
- Availability and integrity of the API, worker, PostgreSQL, and object storage.

Medical data is highly sensitive. A resource identifier, checksum, filename,
processing state, or fact that a document exists can itself be sensitive.

## Trust boundaries

1. Browser to Fastify API over an authenticated transport.
2. API/worker to PostgreSQL.
3. API/worker to `ObjectStorage/v1` and the configured local storage root.
4. Untrusted document bytes/text to security checks and deterministic parsing.
5. Future deployment to S3, OCR, or LLM provider networks.
6. Operators, logs, metrics, traces, backups, and exported files.

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
- Document instructions attempting prompt injection against future agents.

## Threats and required controls

| Threat | Impact | Required control | Delivery gate |
| --- | --- | --- | --- |
| IDOR/cross-family query | Disclosure or modification of another tenant's data | Resolve actor server-side; scope every query by authorized family/profile; test two families; return non-disclosing `404` | First slice |
| Implicit family-wide access | Adult/caregiver sees an ungranted profile | Separate membership from profile consent; capability-based grants; default deny | Basic owner path in first slice; full roles before real data |
| Duplicate checksum oracle | Confirms another family has a document | Deduplicate and report matches only within `family_id`; no global match response | First slice |
| Stale/revoked consent | Continued access after permission changes | Check grant on every request; expiry/revocation; invalidate affected sessions/cache; audit denial | Before real data |
| Session theft/CSRF | Account takeover or state-changing request | Secure, HttpOnly, SameSite session cookies or equivalent bearer protections; CSRF defense where cookies are used; rotation and logout | Before real data |
| MIME/extension spoofing | Unsafe parser input | Allowlist PDF/JPEG/PNG, inspect magic bytes, reject mismatch, set bounded size/page/count limits | PDF subset in first slice |
| Malformed PDF/parser exploit | Code execution, crash, or data disclosure | Maintained permissive parser, sandbox/least privilege, time and memory limits, security updates, adversarial tests | Isolation hardening before real data |
| Path traversal/symlink race | Read/write outside storage root | Ignore user filename for keys; canonical root containment; safe permissions; atomic creation; reject links | First slice |
| Upload memory/disk exhaustion | Denial of service | Stream with byte limit; quotas/rate limits; staging cleanup; disk monitoring; reject early | Stream/size in first slice; quotas before real data |
| Malware in accepted document | Harm when viewed/exported | Quarantine/security-check state, safe content disposition/viewer, production malware strategy isolated behind reviewed boundary | Strategy and implementation before real data |
| Partial upload/database failure | Orphaned blob or document that cannot be read | Staging/finalization protocol; visible failed state; bounded orphan cleanup; never claim success early | First slice |
| Original mutation | Loss of evidence/provenance | Immutable version keys; stored SHA-256 and size; verify checksum on controlled reads/backup restore | First slice |
| Job retry/race | Duplicate or contradictory medical records | Stable job dedupe key; leased claims; compare-and-set transitions; DB uniqueness; transactional confirmation | First slice |
| Poisoned extraction | Incorrect value presented as truth | `ExtractedFact` is untrusted and separate from `Observation`; strict schema; confidence/review gate; preserve raw value | First slice |
| Prompt injection | Future LLM follows document instructions | Treat text as quoted data; fixed system policy; tool allowlist; strict schema; deterministic pre/post safety layer | Before any LLM |
| Unsafe medical output | Diagnosis/treatment harm or missed urgency | Role-limited agents; confirmed data only for longitudinal use; rule-based red flags; evidence/confidence/missing-data labels; clinician escalation | Before recommendation features |
| Provider egress without consent | Sensitive document sent externally | External OCR/LLM disabled by default; owner configuration and clear provider warning; minimize payload; audit egress | Before any external provider |
| SSRF through URL/provider config | Access to internal network or cloud metadata | No arbitrary URL ingest in first slice; allowlisted endpoints; URL parsing, DNS/IP checks, redirect limits, egress policy | Before URL/provider features |
| Signed-link leakage | Temporary public access to a document | First slice proxies authorized reads; later presigned URLs are single-purpose, short-lived, non-logged, and tenant-bound | Before S3 |
| Sensitive logs/traces | Persistent secondary disclosure | Never log bodies, text, medical values, raw filenames, tokens, or signed URLs; redact errors; no patient labels in metrics | First slice |
| Secret exposure | Provider/database compromise | Environment/secret manager, least privilege, rotation, no secret in repo/log/client image | Before real data |
| Dependency/license compromise | Code execution or prohibited distribution | Lockfile, minimal dependencies, license allowlist, vulnerability review, reproducible CI, update policy | From scaffold onward |
| Audit tampering or overcollection | No accountability or new privacy leak | Append-only semantics and restricted reads; record identifiers/action/result/time, not medical payload; integrity/retention policy | Events in first slice; hardening before real data |
| Backup loss/disclosure | Irrecoverable or leaked history | Encrypted backups, separate access, retention, checksum, documented restore drills, deletion propagation | Before real data |
| Export/account deletion bug | Incomplete portability or unintended destruction | Verified export manifest/checksums; explicit confirmed deletion workflow; grace period and audit; backup retention disclosure | Full MVP, before production |

## First-slice security invariants

- Synthetic PDF only; no real medical data enters the repository or demo flow.
- Every family/profile/document/fact/observation query starts from the authorized
  tenant scope, including worker queries.
- Upload is streamed, bounded, signature-checked, hashed, and stored under an
  opaque trusted key.
- Original bytes are immutable. Duplicate detection never crosses tenant
  boundaries and never automatically deletes content.
- Deterministic parsing has no network egress. OCR and LLM adapters are absent or
  disabled, not mocked as successful stages.
- Raw extraction cannot become a confirmed observation without explicit review.
- State changes and medical persistence are idempotent and transactional.
- Logs, tests, and audit metadata contain no document bodies or medical values.

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

- Integration tests use two families and attempt every document, fact,
  observation, history, review, and download operation across the boundary.
- Contract tests attempt traversal keys, mismatched MIME/signatures, oversized
  streams, interrupted writes, and checksum mismatch.
- Concurrency tests replay uploads, job claims, and confirmations.
- Fault injection fails before/after storage finalization and before transaction
  commit, proving no partial observation is created.
- Log assertions reject synthetic medical value and document body leakage.
