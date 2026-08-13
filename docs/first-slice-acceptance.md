# First-slice acceptance evidence

**Recorded:** 2026-08-13
**Code baseline:** local Task 22 worktree atop `bc6d26c feat: browse immutable summary versions`
**Execution context:** repository root on Node.js `v22.22.3` and pnpm `10.4.1`

This record is local, reproducible acceptance evidence for Veylta's first
vertical slice. It is not a production-readiness, clinical-safety, privacy, or
legal-compliance certification. It records acceptance through Task 22; the
Task 22 changes remain subject to the fresh command results below.

## Accepted path

With checked-in synthetic PDF and generated synthetic PNG/JPEG fixtures, the accepted path is:

```text
opaque demo session → owner-scoped family/profile → PDF/PNG/JPEG upload → immutable
local original + SHA-256 → deterministic extraction → explicit review →
confirmed observation → source-first history → immutable non-clinical summary →
immutable summary-version selection → explicit source-set comparison →
re-authorized source download
```

The path is intentionally narrow. The parser accepts one explicit synthetic
report grammar from a PDF text layer, bounded rendered-PDF OCR, or bounded
direct PNG/JPEG OCR; an extracted fact is never silently promoted to an
observation. Confirmation and correction create a source-linked observation
atomically; rejection creates none. A correction preserves the raw extracted
fact and represents the user-confirmed source value separately.

## Implementation lineage

| Commit | Delivered boundary |
| --- | --- |
| `ac5208c` | Product, architecture, threat model, MIT and dependency-license boundary. |
| `320ac77` | Runnable TypeScript workspace, Fastify/Next.js processes, SQLite migrations, and quality harness. |
| `506b099` | Owner-scoped synthetic family and patient profiles. |
| `4199184` | Immutable local PDF storage, streamed SHA-256, same-family duplicate detection, and authorized download. |
| `23e9678` | Product name: Veylta. |
| `e603cc7` | Durable idempotent deterministic extraction of synthetic laboratory facts. |
| `424b25f` | Explicit review decisions and atomic, immutable confirmed observations. |
| `c949b8f` | Authorized source-first confirmed-observation history. |
| Task 15 worktree | Local caregiver invitation with default-deny, explicit read-only profile sharing. |
| `46de15e` | Direct synthetic PNG/JPEG ingestion, bounded local OCR, and immutable content-type provenance. |
| Task 17 worktree | Authorized source-first profile overview with bounded document/review/observation projections. |
| Task 18 worktree | Owner/self-only local synthetic evidence TAR with bounded, checksummed source bytes. |
| Task 19 worktree | Offline, no-extraction verifier for the narrow local synthetic evidence TAR. |
| Task 20 worktree | Versioned non-clinical evidence summary after final human review. |
| Task 21 worktree | Authorized newest-first immutable summary-version index and exact historical snapshot read. |
| Task 22 worktree | Authorized immutable summary source-set comparison without a health assessment. |

## Fresh local verification

All commands below were run from the repository root on the recorded date. A
passing result means the command exited successfully; counts are reported from
its output.

| Command | Result |
| --- | --- |
| `pnpm license:check` | Passed: 8 license groups and 5 exact reviewed exceptions. |
| `pnpm lint` | Passed: Biome checked 83 files; no fixes applied. |
| `pnpm typecheck` | Passed: contracts, API, and web typechecks completed. |
| `pnpm test` | Passed: 91 unit/contract tests (11 contracts, 80 API), 0 failed. |
| `pnpm db:migrate` | Passed: applied/reported migrations `0001_foundation` through `0011_health_summaries`. |
| `pnpm test:integration` | Passed: 44 isolated SQLite integration tests, 0 failed. |
| `pnpm build` | Passed: contracts and API TypeScript builds plus Next.js production build. |
| `pnpm test:e2e` | Passed: 20 Chromium browser tests, 0 failed, including immutable current/historical summary selection, direct synthetic PNG upload/OCR/download, and owner/self evidence-bundle download. |
| `git diff --check` | Passed after this evidence documentation was prepared. |

`tsx` needs a local IPC socket on this host, so its test and migration commands
were executed outside the filesystem sandbox; that is an execution-environment
constraint, not a product exception. The tests themselves use temporary
databases and storage roots where appropriate.

The standalone destructive `pnpm db:rollback` command was deliberately **not**
run against a possibly populated developer `.local` database. Its reversible
behavior is exercised safely by the passing isolated integration test
`all migrations apply, populated processing data rolls back, and migrations
reapply` in
[`apps/api/test/migrations.integration.test.ts`](../apps/api/test/migrations.integration.test.ts).
It creates a temporary database, fills the processing and review graph,
rolls migrations back, and reapplies them. The CI workflow runs the explicit
rollback/reapply sequence on its disposable checkout database.

These are local results, not a claim that a remote GitHub Actions run has
already completed. The checked-in workflow
[`ci.yml`](../.github/workflows/ci.yml) executes the same license, lint,
typecheck, unit, migration, integration, rollback/reapply, build, and browser
gates on every push and pull request.

## Requirement-to-evidence map

| Acceptance requirement | Evidence |
| --- | --- |
| A new developer can start the system with one documented sequence | [README local development](../README.md#local-development) and browser test `the runnable foundation exposes web, API, worker, and SQLite readiness`. |
| Original document survives restart | Integration test `upload, replay, same-family deduplication, download, and restart stay consistent`; local storage restart unit coverage. |
| Direct image stays type-correct and bounded | Integration tests cover exact PNG/JPEG signatures, header pixel cap, immutable MIME provenance, local OCR, and safe type-correct download; the Chromium flow uploads and downloads a direct synthetic PNG. |
| Same-family repeat upload is a possible duplicate | The same integration test and the browser upload scenario show a visible possible duplicate without automatic deletion. |
| Another family cannot use a duplicate or source as an oracle | Integration tests `identical bytes in another family do not disclose or share a blob`, processing/history cross-family reads, and browser test `another family session cannot see a document or its filename`. |
| Extraction has page-level provenance | Processing integration asserts document page and source fragment; `observation-history/v1` integration returns page, fragment, version, and a relative authorized source path. |
| Uncertain data cannot bypass human review | Parser and processing tests keep high-confidence facts unconfirmed and route uncertain facts to review; browser review tests require an explicit decision. |
| A correction preserves raw extraction | Integration test `a correction creates a confirmed observation without changing raw extraction, while rejection creates no observation`; browser review and history scenarios verify the displayed source distinction. |
| Confirmed data appears in history with its source | Integration test `observation history is source-first, paginated, re-authorized, and audited without payloads`; browser test `profile history shows confirmed and corrected observations with their authorized sources only`. |
| Summary remains evidence-backed and non-clinical | Integration tests cover atomic creation after final review, immutable successors, exact historical snapshot reads, source-set deltas, missing context, authorization, and payload-free audits; browser tests cover current and older immutable summary selection plus source-set comparison without a health claim. |
| Profile landing view stays source-first | Integration tests cover bounded overview projections, payload-free audit, non-disclosing denial, and revocable read access; browser upload flow shows the review queue after returning to the profile. |
| Local synthetic evidence snapshot is bounded and non-disclosing | Integration tests cover checksum-verified archive bytes, owner/self-only authorization, `profile.read` denial, five-source cap, cross-family denial, and payload-free audit; the browser flow downloads the TAR attachment. |
| Local evidence snapshot can be checked without extraction | Unit tests accept PDF/PNG/JPEG bundles and confirmed-observation provenance; they fail closed on checksum mutation, traversal, unsupported TAR fields, non-zero padding, and manifest drift. The file command emits counts only. |
| Caregiver remains default-deny until profile consent | Integration and browser tests `a caregiver joins without an implicit profile and reads only an explicitly shared profile` / `a caregiver starts without a profile and sees only a profile explicitly shared by the owner`; SQLite trigger regression prevents caregiver linkage to a personal profile. |
| Failed writes leave no partial medical record | Integration test `an audit failure rolls back review decision, observation, reference range, and idempotency record together`; processing tests cover invalid-output rollback. |
| Retry is idempotent and terminal failure remains visible | Job-service tests cover stable dedupe, exclusive lease/reclaim, replay-safe completion, retry schedule, and dead-letter exhaustion; processing integration covers a replay-safe terminal retry command. |
| Migration rollback/reapply is verified | Isolated migration integration test described above; CI has an explicit `db:rollback` then `db:migrate` sequence. |
| No external OCR/LLM is called | Deterministic processor test forbids network access; no OCR/LLM adapter or provider configuration is present in the first slice. |
| Repository fixtures are synthetic | The checked-in fixture is [`fixtures/veylta-synthetic-lab-report.pdf`](../fixtures/veylta-synthetic-lab-report.pdf); generated PNG/JPEG test fixtures, parser grammar, policy, and E2E flows label every source synthetic. |
| Quality and licensing gates remain reproducible | Fresh command results above and [CI workflow](../.github/workflows/ci.yml). |

## Safety and MIT boundary verified by this slice

- Original Veylta source and documentation are MIT-licensed under
  [`LICENSE`](../LICENSE). The license checker fails closed for unknown,
  prohibited, or unreviewed dependency licenses; the detailed policy and exact
  exceptions are in [license policy](license-policy.md) and
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
- GPL/AGPL code, fixtures, schemas, assets, and copied implementations remain
  outside the core boundary. A future copyleft integration would require a
  separate external-service and license review.
- The completed path is local and synthetic-only. It uses an embedded SQLite
  file and local object storage, binds demo processes to loopback, and sends no
  document data to OCR, LLM, cloud-storage, or telemetry provider.
- API authorization is server-side and family/profile scoped. Relevant reads,
  uploads, review decisions, and history access are audited without medical
  payloads. Tests verify non-disclosing cross-family behavior.
- The security controls proven here are scoped controls, not a replacement for
  a production threat-model review. See [threat model](threat-model.md) for the
  gates still required before any real upload.

## Explicitly not accepted or deferred

The first slice must not be described as production-ready or suitable for real
medical data. In particular, it does **not** deliver:

- real-user onboarding, account recovery, production authentication, full
  adult/caregiver consent management, a public deployment, or a compliance
  certification;
- multi-host/high-availability persistence, backup/restore, production export, controlled
  deletion, or a production migration/operations plan for real records;
- presigned delivery, cloud OCR, LLM extraction, LLM analysis, provider egress,
  or training on user data;
- clinical summaries, clinical comparable-measurement trends, health scoring,
  diagnosis, prescriptions, treatment changes, recommendations, or red-flag
  clinical advice;
- FHIR R4 mapping/import/export, broad laboratory integration, clinic
  workflows, billing, scheduling, or native mobile applications.

The profile history is a source-first table, not a trend or a clinical
interpretation. It may show one or more immutable confirmed observations, but
it does not establish comparability or medical meaning across results.

## Reproduction boundary

Use the documented setup in [README](../README.md#local-development), including
Node.js 22.16+ and `pnpm install --frozen-lockfile`. Run the commands in the
verification table. Before the browser gate, install Chromium with
`pnpm exec playwright install chromium`. Keep all generated state under the
ignored `.local/` directory, and never replace the synthetic fixture with a
real medical file.
