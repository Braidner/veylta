# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Veylta — a local-first, family-scoped medical record. Users upload synthetic source
documents, a worker extracts source-bound laboratory facts through a locally
authenticated Codex CLI, and a human must confirm/correct/reject each fact before it
becomes an observation. One household machine: SQLite + a local object root, no cloud.

# Commands

```bash
pnpm db:migrate          # apply db/migrations/*.up.sql
pnpm dev                 # api 4301 + worker health 4302 + web 4300
```

Full check sequence, in CI order:

```bash
pnpm license:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e
```

Single tests:

```bash
pnpm --filter @veylta/api exec tsx --test src/processing/analyte-mapping.test.ts
pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/document-upload.integration.test.ts
pnpm test:e2e e2e/document-review.spec.ts
```

- After editing `packages/contracts`, run `pnpm --filter @veylta/contracts build`. Root
  scripts have `pre*` hooks that do this; a direct `pnpm --filter …` call does not.
- `pnpm exec playwright install chromium` once before the first e2e run.
- `pnpm db:rollback` reverses the newest migration. CI runs migrate → rollback → migrate.

# Workflow

- TDD: write the failing test first, then the code. Close every fixed bug with a test so
  it cannot come back silently.
- Find an existing analogue in the repo and follow its structure, layering, naming, and
  error handling. Do not copy a mistake from the sample — do it right.
- Dig to the root cause. A special case layered on shared infrastructure means the fix is
  too shallow: generalize the mechanism instead of stacking patches.
- Verify the whole path: saved → read back → rendered. One green layer is not a result.
- On a fork in architecture, UX, or product behaviour: show the options with a
  recommendation and wait. Do not decide product questions silently.
- Given a reference (Codex, screenshot, another product's UX), reproduce it 1:1 in our
  colors, style, and terminology.
- After changes, run the tests and linters of what you touched and report numbers.
  "Done" without a green run does not exist. If tests fail, say so with the output.
- Never restore something deliberately deleted or rejected "by analogy" — ask first.
- Boy-scout rule: rewrite smelly code next to your change and cover it with tests. If the
  smell is large and would inflate scope, do not touch it silently — report it and propose
  a separate task.

# Code style

- KISS: no abstraction "just in case", no Interface+Impl pair without a second
  implementation. The simpler solution that does the same job wins.
- DRY: shared logic lives in one place. Branches that must behave alike (validate/save,
  live/replay, two input formats) go through common code, and a test pins that parity.
  A duplicate in a sibling module is a future defect.
- Behaviour lives next to its data; prefer a lookup or a discriminated union over
  `if`/`switch` chains on a type tag. Export the minimum; keep helpers module-private.
- Layering is `routes → service → storage/SQLite` with no leaks between them. Services are
  built by `create*Service(dependencies)` factories — pass collaborators in, never reach
  for a module-level singleton. Extend at an existing seam rather than editing the core.
- TypeScript is strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
  Optional fields use conditional spread: `...(x === undefined ? {} : { x })`.
- `module: NodeNext` — relative imports carry the `.js` extension even in `.ts` sources.
- A comment answers "why" and records a constraint the code cannot show. Never restate the
  line below it.
- UI text is Russian; code, comments, and commit messages are English, matching the history.
- UI work follows `DESIGN.md`: OKLCH tokens, gradient reserved for the primary action,
  explicit review labels (`Extracted` / `Needs review` / `Confirmed` / `Rejected`),
  provenance as a real source link with document, page, and quoted fragment.

# Tests

- `node:test` + `node:assert/strict`. Unit tests are colocated `*.test.ts`; anything
  touching a real SQLite file is `apps/api/test/*.integration.test.ts` and builds its own
  temp database via `mkdtemp` + `migrateUp`. Never touch `.local/veylta.sqlite`.
- Pure logic belongs in a testable `*.ts` module beside the component, not inside the
  `.tsx`. See `document-agent-workspace.ts`, `profile-dashboard.ts`, `account-access.ts`.
- `scripts/run-e2e.mjs` puts a **fake `codex` executable** on `PATH` for the whole e2e run.
  Changing the CLI invocation shape (flags, schema, output file) means updating that stub.
  For `--image` it "transcribes" one fixed synthetic report per attached page, as does
  `apps/api/test/synthetic-intelligence.ts` — neither reads pixels; tests exercise plumbing.
- Some e2e specs stub the API with `page.route`. A stub that drifts from the real contract
  is worse than no stub — update it in the same change as the contract.
- Known flaky under a full-suite run: `document-review.spec.ts:178` (fails every full run,
  passes alone) and `document-agent.spec.ts:27` (a last-write-wins race in the spec's own
  mock; passes alone). Check `main` before blaming your change.

# Architecture

**Three processes, one SQLite file.** `apps/api/src/database/pool.ts` wraps `node:sqlite`
with a per-process serialization queue; writes go through `database.transaction()`, which
opens `BEGIN IMMEDIATE`. No ORM.

**Migration readiness gate.** `pool.ts` holds a `requiredSchemaMigration` constant. A new
migration MUST bump it, or `/readyz` reports OK against a database missing the newest
tables and the failure surfaces as a request-time 500 instead. Every migration needs a
working `.down.sql` because CI rolls back and re-applies.

**Versioned contracts.** `packages/contracts/src/index.ts` exports one `*_CONTRACT_VERSION`
per public boundary. Read the file — do not trust a version quoted elsewhere, including
here. A shape change bumps the version string and updates every literal copy in tests and
e2e stubs.

**Route conventions** (`apps/api/src/http/route-helpers.ts`): every handler resolves the
actor with `requireActor`; mutations also pass `requireTrustedOrigin` and mostly require an
`Idempotency-Key` scoped to family + actor. Services throw `ResourceNotFoundError` /
`DomainConflictError` / `DomainValidationError`; `sendDomainError` maps them to 404/409/422.
Cross-tenant and unauthorized resources return **404**, never 403 — IDs are selectors,
never proof of access.

**Codex boundary.** All model access goes through `codex/codex-cli-executor.ts`, which
shells out to the local `codex` CLI, strips `OPENAI_*` from the child environment, bounds
input/output bytes, and kills on timeout. Veylta never reads, copies, or persists Codex
credentials. **There is no local OCR.** A PDF text layer travels as text; a scanned PDF or a
direct PNG/JPEG travels as bounded page images (`processing/document-images.ts`) attached with
`--image`, and the model must transcribe each page first. Every fragment is bound to that
transcription exactly as to a text layer; the page is stored with
`extraction_method = codex_vision`. A run sends text or images, never both. The per-document
agent registers a short-lived loopback MCP endpoint whose only tool re-authorizes the
server-derived scope and returns bounded projections — never storage keys, paths, or file bytes.

**Document workspace: two different "threads."** «Диалоги» are user-created
`document_agent_conversations`; «Запуски Codex» are `processing_jobs`. Both arrive in one
`DocumentAgentWorkspaceResponse`, **newest run first**, and run titles («Первичный анализ»,
«Повторный анализ N») are derived positionally, not stored. The rail selects what the main
panel shows: a run id pins `GET …/processing?runId=` and renders that run's journal there;
null returns the panel to the conversation. There is no standalone journal section — the
panel renders a journal only while `activityRunId` matches the pinned run, so a slower
response cannot appear under the wrong run's heading.

**Object storage** is behind `ObjectStorage/v1`. `storage-controller.ts` is the only
runtime port for api and worker. Uploads stream through SHA-256; controlled reads take a
bounded checksum-verified snapshot before returning bytes. Keys derive from trusted IDs +
checksum, never user filenames.

**Settings serves two audiences.** Server administration (Codex, storage, accounts) is
admin-only; family profiles and access («Профили и доступ») are for any family owner and never
call `/v1/settings`. `canOpenSettings` gates the tab; a link from a profile carries
`?profile=` so management opens on that person. Profile management is not on the documents tab.

**One hero.** `components/page-hero.tsx` is the shell for both the document detail page and
the documents archive; the two wrappers stay thin. On those tabs the profile heading steps
aside, so the tab-level `padding-top` is removed for `.profile-shell--documents` too.

**Web ↔ API.** The browser never calls port 4301; `next.config.ts` rewrites
`/health-api/:path*` to `API_INTERNAL_URL`. Session state is an opaque token in an HttpOnly
cookie; SQLite stores only its SHA-256 digest.

# Domain invariants

YOU MUST NOT relax these to make a feature easier.

- `ExtractedFact` is untrusted model output and is never mutated. A `ReviewDecision` is
  immutable; `confirm`/`correct` create an `Observation` in the same transaction, `reject`
  creates none.
- Reject a Codex extraction unless every fact cites an exact source fragment with a page
  number. Fail closed rather than accept an unbound fact. Verification is per item: an
  unbound fact or summary result is dropped, the verified rest is kept, and only an answer
  whose every item fails is refused. Bookkeeping slips (a repeated key, a unit repeated
  inside the value, a fragment stitched from non-adjacent lines that still names one unique
  value line) are normalised deterministically — never taken on trust, never fatal.
- A model-proposed normalization survives only in the identity case (same number under a
  canonical unit spelling); Veylta performs no unit conversions and never carries a model's
  converted number into an observation. `resolveAnalyteMapping` derives the normalized value
  from the printed one.
- In a laboratory report the summary's numeric measurements are the facts: an answer whose
  facts miss most of them is refused as `incomplete_facts` so the retry asks again, instead
  of presenting a fraction of the document as the whole.
- Audit events are payload-free: actor, tenant, action, resource selector, result, time.
  No filenames, medical values, fragments, or cursors. This holds without exception —
  `processing_job_exchanges` is never copied into an audit event.
- The run journal is the one diagnostic surface that may carry document content: it shows
  the owner their own source and Codex's raw answer for a failed run. It is reachable only
  through the same profile authorization as the document. Worker stdout, logs, metrics, and
  audit rows stay payload-free.
- A rejection reason is always a server-derived code from `PROCESSING_REJECTION_REASONS`,
  rendered through `rejectionReasonCopy`. Never surface a sentence the model produced as
  the reason a run failed.
- The UI must not produce a health score, diagnosis, triage, risk, trend, or treatment
  advice — including from a comparison of two summary versions.
- Archiving a profile flips `patient_profiles.archived_at` only; it never deletes sources,
  facts, observations, audit rows, or storage objects.
- Synthetic data only, in fixtures, tests, screenshots, and logs. Never commit real medical
  documents or secrets.
- New dependencies must satisfy `config/license-policy.json` and be recorded in
  `THIRD_PARTY_NOTICES.md`; `pnpm license:check` enforces it.
