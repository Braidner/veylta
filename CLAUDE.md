# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Veylta — a local-first, family-scoped medical record. Users upload synthetic source
documents (PDF/PNG/JPEG), a worker extracts source-bound laboratory facts through a
locally authenticated Codex CLI, and a human must explicitly confirm/correct/reject
each fact before it becomes an observation. Everything runs on one household machine:
SQLite + a local filesystem object root, no cloud control plane.

Read `README.md`, `docs/architecture.md`, `docs/slices.md`, and `DESIGN.md` before
making product-shaped changes. `docs/slices.md` defines the numbered task plan and
delivery rules the commit history follows.

## Commands

```bash
corepack enable && pnpm install --frozen-lockfile
pnpm db:migrate          # apply db/migrations/*.up.sql
pnpm dev                 # api (4301) + worker health (4302) + web (4300), via scripts/dev.mjs
```

Full check sequence (same order as `.github/workflows/ci.yml`):

```bash
pnpm license:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e
```

- `pnpm lint` / `pnpm format` — Biome (2-space, 100 cols, double quotes, semicolons).
- `pnpm test` — per-workspace `node:test` via `tsx`, plus the veylta-agent bridge tests.
- `pnpm test:integration` — API tests against temporary SQLite files (`--test-concurrency=1`).
- `pnpm test:e2e` — Playwright through `scripts/run-e2e.mjs`; extra args pass through.
- `pnpm db:rollback` — reverse the newest migration. CI runs migrate → rollback → migrate.
- `pnpm exec playwright install chromium` once before the first e2e run.

Single tests:

```bash
pnpm --filter @veylta/api exec tsx --test src/processing/analyte-mapping.test.ts
pnpm --filter @veylta/api exec tsx --test --test-concurrency=1 test/document-upload.integration.test.ts
pnpm test:e2e e2e/document-review.spec.ts
```

Root scripts have `pre*` hooks that build `@veylta/contracts` first. A direct
`pnpm --filter …` invocation does not — rebuild contracts manually after editing them:
`pnpm --filter @veylta/contracts build`.

Local artifact verifier: `pnpm --filter @veylta/api verify:evidence-bundle ./bundle.tar`.

## Layout

```
apps/api/       Fastify HTTP entry (src/server.ts), worker entry (src/worker.ts), all domain services
apps/web/       Next.js 16 App Router PWA; no medical domain rules
packages/contracts/  versioned HTTP + extraction schemas shared by both
db/migrations/  ordered NNNN_name.up.sql / .down.sql pairs
e2e/            Playwright specs; e2e/support/ holds synthetic fixtures builders
skills/veylta-agent/  Codex-side skill + local bridge for the vault protocol
```

API and worker are two runtime entries from one workspace. Shared code moves into
`packages/contracts` only when both web and api genuinely need it.

## Architecture notes

**Three processes, one SQLite file.** `apps/api/src/database/pool.ts` wraps
`node:sqlite` with a per-process serialization queue; writes go through
`database.transaction()` which opens `BEGIN IMMEDIATE`. Foreign keys, WAL, 5s busy
timeout, and `synchronous=NORMAL` are set on every connection. There is no ORM.

**Migration readiness gate.** `pool.ts` holds a `requiredSchemaMigration` constant
(currently `0021_codex_preferences`). Adding a migration means bumping that constant,
or `/readyz` and the worker probe fail. Every migration needs a working `.down.sql`
because CI rolls back and re-applies.

**Versioned contract markers.** `packages/contracts/src/index.ts` exports one
`*_CONTRACT_VERSION` string per public boundary (`document/v4`,
`observation-history/v1`, `home-care-plan/v1`, …). Responses carry the marker and
audit events store it. A shape change means bumping the version string, not editing
the existing one silently.

**Route conventions** (`apps/api/src/http/route-helpers.ts`): every handler resolves
the actor with `requireActor`, mutations additionally pass `requireTrustedOrigin`
(exact `WEB_ORIGIN` match) and most require an `Idempotency-Key` scoped to family +
actor. Path params validate against `canonicalUuidSchema`. Services throw
`ResourceNotFoundError` / `DomainConflictError` / `DomainValidationError`; `sendDomainError`
maps them to 404/409/422. Cross-tenant and unauthorized resources return **404**, never
403 — IDs are selectors, never proof of access.

**Object storage** is behind `ObjectStorage/v1` (`apps/api/src/storage/`).
`storage-controller.ts` is the only runtime port used by api and worker; it reads the
authoritative root and generation from SQLite so an administrator relocation is picked
up without a query per read. Uploads stream through SHA-256; controlled reads take a
bounded checksum-verified snapshot (5 MiB cap) before returning bytes. Keys are derived
from trusted IDs + checksum, never user filenames.

**Codex boundary.** All model access goes through `apps/api/src/codex/codex-cli-executor.ts`,
which shells out to the locally installed `codex` CLI. It verifies `codex --version` and
`codex login status`, strips `OPENAI_*` from the child environment, bounds input/output
bytes, and kills on timeout. Veylta never reads, copies, or persists Codex credentials.
Three consumers: document intelligence (worker), care-plan proposals (api), and the
per-document agent. The agent runtime registers a short-lived loopback MCP endpoint
(`/mcp/document-agent`) with a hashed bearer capability; its only tool re-authorizes the
exact server-derived scope and returns bounded projections — never storage keys, paths,
or file bytes.

**Web ↔ API.** The browser never calls port 4301 directly; `apps/web/next.config.ts`
rewrites `/health-api/:path*` to `API_INTERNAL_URL`. Session state is an opaque token in
an HttpOnly cookie; SQLite stores only its SHA-256 digest.

**Worker loop.** `worker.ts` polls SQLite for leased jobs, runs the extraction processor,
and commits facts or a retry/dead-letter transition in one transaction. Its stdout is a
sanitized outcome only — no job IDs, filenames, text, values, or stack traces.

## Domain invariants

These are enforced in code and tests; do not relax them to make a feature easier.

- `ExtractedFact` is untrusted parser/model output and is **never** mutated. A
  `ReviewDecision` is immutable; `confirm`/`correct` create an `Observation` in the same
  transaction, `reject` creates none.
- Codex extraction results are rejected unless every fact cites an exact source fragment
  with a page number. Fail closed rather than accept an unbound fact.
- Audit events are payload-free: actor, tenant, action, resource selector, result, time.
  No filenames, medical values, fragments, or cursors.
- The UI must not produce a health score, diagnosis, triage, risk, trend, or treatment
  advice — including from a comparison of two summary versions.
- Archiving a profile flips `patient_profiles.archived_at` only; it never deletes sources,
  facts, observations, audit rows, or storage objects. Every authorization query and job
  claim requires an active profile.
- Synthetic data only — in fixtures, tests, screenshots, and logs. Never commit real
  medical documents or secrets.

## Working conventions

- TypeScript is strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
  Optional fields use conditional spread: `...(x === undefined ? {} : { x })`.
- `module: NodeNext` — relative imports carry the `.js` extension even in `.ts` sources.
- Tests are `node:test` + `node:assert/strict`, colocated as `*.test.ts` for unit tests and
  in `apps/api/test/*.integration.test.ts` for anything touching a real SQLite file.
  Integration tests build their own temp database via `mkdtemp` + `migrateUp`; they never
  touch `.local/veylta.sqlite`.
- `scripts/run-e2e.mjs` writes a **fake `codex` executable** onto `PATH` for the whole e2e
  run. Changing the CLI invocation shape (flags, schema, output file) requires updating
  that stub or every e2e spec breaks.
- New dependencies must satisfy `config/license-policy.json` (MIT / Apache-2.0 / BSD / 0BSD,
  plus reviewed per-version exceptions) and be recorded in `THIRD_PARTY_NOTICES.md`;
  `pnpm license:check` enforces it.
- UI work follows `DESIGN.md`: OKLCH tokens, gradient reserved for the primary action,
  explicit review labels (`Extracted` / `Needs review` / `Confirmed` / `Rejected`),
  provenance rendered as a real source link with document, page, and quoted fragment.
- Ports: dev 4300/4301/4302, Playwright 4400/4401/4402. Local state lives in
  `.local/veylta.sqlite` and `.local/storage`. Copy `.env.example` to `.env` only for
  overrides — defaults already match it.
