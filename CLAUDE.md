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

`pnpm lint` also runs `scripts/check-file-lines.mjs`: **no source file may exceed 250
lines**. Files that were already larger are listed with their size in
`config/file-length-baseline.json`; a listed file may only shrink and must leave the list once
it fits (`pnpm lint:lines --write` lowers the baseline, never raises it or adds a file). Split
a file rather than growing a legacy one.

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
- One file, one responsibility, under 250 lines. A module that carries state gets a small
  class (`SourceText`, `KeyRegistry`, `CodexAnswerParser`); stateless steps stay functions.
- Every prompt lives in `apps/api/src/prompts/*.prompt.ts`, one file per prompt, exporting a
  builder that takes typed input; the calling code holds no model-facing sentences. Tests pin
  the phrases the parser or the UI depend on — change prompt and test together.
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
- `scripts/run-e2e.mjs` puts a **fake `codex` executable** on `PATH` for the whole e2e run;
  its body lives in `scripts/fake-codex.mjs` (probes, app-server) and `scripts/fake-codex-exec.mjs`
  (one `exec` branch per output schema: extraction, physician answer, checker, care plan).
  Changing the CLI invocation shape (flags, schema, output file) means updating that stub.
  For `--image` it "transcribes" one fixed synthetic report per attached page, as does
  `apps/api/test/synthetic-intelligence.ts` — neither reads pixels; tests exercise plumbing.
  The API-side twin for the assistant is `apps/api/test/assistant-app.ts` (a scripted runtime).
- Some e2e specs stub the API with `page.route`. A stub that drifts from the real contract
  is worse than no stub — update it in the same change as the contract.
- The suite has no known flakes. A spec must never assert a calendar date the app writes at
  run time (`e2e/support/decision-journal.ts` checks a decision time against the clock), and
  workspace panels must not let a background reload override a selection or mutation in
  flight (`apps/web/app/workspace-requests.ts`, `intendedConversation` in the agent panel).

# Architecture

**Three processes, one SQLite file.** `apps/api/src/database/pool.ts` wraps `node:sqlite`
with a per-process serialization queue; writes go through `database.transaction()`, which
opens `BEGIN IMMEDIATE`. No ORM.

**Migration readiness gate.** `pool.ts` holds a `requiredSchemaMigration` constant. A new
migration MUST bump it, or `/readyz` reports OK against a database missing the newest
tables and the failure surfaces as a request-time 500 instead. Every migration needs a
working `.down.sql` because CI rolls back and re-applies. Integration tests never copy the
migration list: `test/migration-chain.ts` reads it from `db/migrations` (`rollbackTo`,
`reapplyFrom`, `migrationNames`), so adding a migration edits no test.

**Profile authorization** is one rule in `family/profile-access.ts` (`profileAccess`,
`requireProfileWrite`, `canonicalProfileScope`): owner or linked adult writes, a live
`profile.read` grant reads, everything else is a 404. New profile-scoped services use it
rather than restating the SQL.

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

**Document intelligence provider** (`processing/codex-document-intelligence-provider.ts`) is
a thin entry over `processing/codex-intelligence/`: `answer-schema.ts` (the closed JSON schema
and the field lists the parsers reuse), `field-parsers.ts` (primitive readers that verify or
refuse), `readings.ts` (numbers, repeated units, verified normalization, range membership),
`source-text.ts` (`SourceText`: page lookup and fragment-to-line provenance),
`document-pages.ts` (text layer in, transcription out), `answer-items.ts` (`KeyRegistry`,
per-item `keptItems`), `structured-result-parser.ts` / `fact-parser.ts`,
`result-binding.ts` (content binding, status settlement, completeness), `answer-parser.ts`
(`CodexAnswerParser` assembling one verified output), `codex-run.ts` (one CLI invocation with
its exchange), `exchange.ts`, `known-analytes.ts`, `constants.ts`, `errors.ts`. Tests sit
beside them by theme (`provenance.test.ts`, `result-binding.test.ts`, …) over shared
`test-support.ts` fixtures and exercise the public `analyze()`.

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

**Medical profile** (`medical-profile/v2`, `apps/api/src/medical-profile/`): what a person
records about themselves for the assistants — sex, birth year, height, weight, pregnancy
(singletons), conditions, medications, allergies, symptoms, goals, constraints… User-authored,
dated (`recordedOn`), revisioned, archived rather than deleted; closed and numeric kinds are
validated in `medical-profile-values.ts`. `entries` are the active ones; `measurements` (height
and weight) come from every entry ever recorded, archived included, oldest first — a new weight
is a new dated entry after the previous is archived, so the passport can show the series. Create is `PUT entries/:id` with a client id (201 /
200 replay / 409 on a different body), update `PUT …/value` and archive `PUT …/archive` are
optimistic on `revision`. `interpretationReady` is true once sex and birth year exist — the
assistants refuse to interpret values without them.

**Assistants** (`assistant/v3`, `apps/api/src/assistant/`, docs/assistants.md). «ИИ-врач ·
второе мнение» is a profile-scoped conversation at
`/v1/families/:f/profiles/:p/assistants/physician` (web route `…/assistants/physician`, entered
from the overview card). `evidence.ts` is the only thing that leaves the machine — medical
profile, bounded confirmed observations with printed ranges, care plan — and the same loader
feeds both the prompt and the workspace's `evidenceCount`/`evidence` index, so the egress
disclosure never describes something other than what is sent. A conversation must be
acknowledged (`PUT …/acknowledgement`, `send_confirmed_evidence_to_codex`) before its first
message (409 `ACKNOWLEDGEMENT_REQUIRED` otherwise). `assistant-turn.ts` runs one turn:
`codex exec` / `exec resume` on the conversation's thread (`codex-assistant-runtime.ts`: the
dialogue model at `assistantReasoningEffort`, a settings field defaulting to high; web search
off), `answer-parser.ts` verifies every block against the evidence, `answer-checker.ts` runs an
independent refuting exec and applies its verdicts, and
every model failure becomes a refusal with a closed `ASSISTANT_REJECTION_REASONS` code plus its
raw exchange in `assistant_exchanges` (owner-only journal, never audit). Web: pure copy tables in
`app/assistant.ts`, `assistant-workspace.tsx` (data) → `assistant-panel.tsx` (shell) →
`assistant-answer.tsx`/`assistant-blocks.tsx` (typed blocks, source links, referral → care-plan
`clinician` item through the plan's own `PUT items/:id`). Browser routes live in `app/paths.ts`.
A conversation may carry a `purpose` (`dossier:<specialty>` | `dossier:consilium`, migration
0033, one per profile and purpose): `POST conversations` with a purpose finds the existing one
before creating (200, not 201), so the dossier's questions to one doctor stay in one place —
«Досье · Кардиолог», «Досье · Консилиум». The dossier opens the assistant with `?ask=<specialty>`
or `?ask=consilium` (`assistantAskPath`) and leaves the composed question in `sessionStorage`
(`app/dossier-ask.ts`: `askQuestion`, `stashDossierAsk`/`takeDossierAsk`, `askConversationTitle`,
`askAddressee` — the URL carries only the addressee, never a value); the workspace finds or creates
the purpose conversation, prefills the composer (addressed to the persona for a specialist, to the
therapist for the therapist's group and the консилиум) and the person still reads and sends.
**Консилиум** (`POST …/conversations/:id/consilium`, `consilium-turn.ts`): who joins is decided
from the evidence by `consilium-panel.ts` over `analyteSpecialty` in
`packages/contracts/src/analytes.ts` (catalog code → area and specialty; sex hormones by recorded
sex; ties in `ASSISTANT_SPECIALTIES` order; ≤5) plus whoever the person adds; every persona
(`prompts/assistant-specialist.prompt.ts`, first line `Specialty: <id>` — the fakes key on it)
reads the same evidence in its own thread and is verified and refuted like any answer; the
therapist synthesises on the conversation's thread (`assistant-synthesis.prompt.ts`,
`synthesis-parser.ts`: the physician answer plus `agreements`, each note bound to invited
specialties) and the checker refutes the synthesis with the opinions in view. The synthesis is
the message's `answer`; `consilium` carries invitations, opinions and agreements, so no
disagreement can be averaged away. A message with `addressee` runs that persona alone
(`speaker`), never touching the therapist's thread. Exchanges: `opinion`/`checker` per specialty,
`synthesis`, `checker`.

**Досье** (web tab `dossier`, alias `plan` in `app/paths.ts`) is the cabinet a person shows
their doctor; the profile greeting steps aside on this tab. Pure modules: `app/dossier-passport.ts`
(`passportOf`, `identityLine`, `identityChips` — BMI as a number only, never a category;
`measurementSeries` — weight/height over time, the change since last time, «пора обновить» after
`measurementFreshDays`), `app/dossier-numbers.ts` (`numberOf`, `printedDelta` shared by series and
passport), `app/dossier.ts` (`buildDossierSeries` — one series per code and printed unit, oldest first,
status from the printed bounds, then the laboratory's flag, else `unknown`; `seriesAssessment`;
`attentionBySpecialty`), `app/dossier-areas.ts` (`areaSummaries` in `ANALYTE_AREAS` order,
`statusCounts`, `statusLine`, `readersCopy`), `app/dossier-scale.ts` (`gaugeScale`: the printed
bounds as a band on a track, the value as a marker, the track stretched so an outside value stays
visible — placed, never graded). Components: `dossier-panel.tsx` (loads the medical profile and
the paged observation history; holds the selection and the editing mode; choosing a section scrolls
its page into view) → left `dossier-passport.tsx` (inline sex/birth-year form while not ready;
`dossier-measurements.tsx` — weight/height rows with sparkline, delta and «Обновить», a new value
archives the previous entry and creates a dated one; the pencil opens the editor in the right
column) + `dossier-rail.tsx` (the record's areas with counts and outside marks); right
`dossier-focus.tsx` (whole record or one area: heading with `StatusStrip`, `dossier-attention.tsx`
— gauge cards grouped by specialty with «В план: визит» writing a `clinician` item and «Спросить
ИИ-врача, насколько срочно» — then area tiles or the area's remaining `dossier-gauge.tsx` cards with
`dossier-sparkline.tsx`). The heading's `identity-chips.tsx` reads the same passport on the other
tabs. The synthetic parser and the fake codex read «low–high unit» references into printed bounds
(`processing/printed-bounds.ts`), so the e2e stand exercises out-of-range values without stubbing
the API.

**Analyte catalog.** `analyte_catalog` + `analyte_aliases` (migrations 0017 and 0028) hold
household codes (`hemoglobin`, `cholesterol.ldl`, `tsh`, …), a canonical unit each and the
printed spellings (`source_name_key`, `source_unit_key`). Every request carries the catalog
as `knownAnalytes` and the schema pins `proposedCanonicalCode` to its codes; at read and
confirm time `resolveAnalyteMapping` maps by exact normalized name + unit. Alias keys are
whatever `normalizeAnalyteName` / `normalizeAnalyteUnit` produce — `normalizeAnalyteUnit`
transliterates Cyrillic unit atoms («г/л» → `g/l`, «мМЕ/л» → `miu/l`) and folds the
power-of-ten spellings («10 9 /л», `×10⁹/L`, `10^9/L` → `109/l`), so a printed and a
canonical spelling of one unit share a key. Adding an alias means writing the key the
normalizer would produce; `test/analyte-catalog.integration.test.ts` fails otherwise. Codes
are household identifiers, not a clinical vocabulary; unitless analytes (INR, atherogenic
index) are not seeded yet.

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
  value line, a name broken over two printed lines) are normalised deterministically — never
  taken on trust, never fatal. A fact's `sourceName` is the name printed in the value's own row
  (`codex-intelligence/printed-name.ts`): a column header, page label or key in its place is
  replaced by the catalog's spelling of the proposed code found on that row, or the fact is
  dropped; a unitless row keeps the mark `—` (`readings.ts` `printedUnit`) — a range, a flag or
  a placeholder is never a unit.
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
- Two grades of assessment, both recommendations that end in a named specialist
  (PRODUCT.md «What Veylta itself may say»). **Deterministic**: Veylta's own rules over
  confirmed values and the dossier — outside the printed range or flagged by the laboratory,
  the change against the previous confirmed value and along the series, a repeating finding,
  a value the dossier says to watch — stated plainly with how long it can wait and the analyte's
  specialty (`packages/contracts/src/analytes.ts` is the one code→area/specialty table); never an
  invented number, a converted unit, a single index over findings, or a diagnosis from a rule.
  **Model**: hypotheses, treatment options and questions come only from an assistant, as
  verified output: every hypothesis and treatment option names `confirmWith`, every answer
  carries an urgency tier rendered as fixed copy that a later block cannot lower, no
  medication is ever proposed with a dose, `general` text may not quote the person's values,
  an unbound block is dropped, a fully refuted answer is refused with a closed reason. Nothing
  of either grade becomes a plan item, an observation, or a record without a human action. Sex
  and birth year missing → `missing` blocks only. The refusal reason shown is always the closed
  code's copy, never a model sentence.
- Assistant egress is disclosed and acknowledged per conversation; the payload is exactly what
  `assistant/evidence.ts` builds — never a document, page, file, path, key, or family/profile
  ID. The raw exchange and checker verdict live in `assistant_exchanges` for the owner only.
- A консилиум's panel is decided by the code→specialty table plus the person's additions, never
  by the model; every opinion is verified and refuted on its own and shown beside the synthesis;
  the synthesis is verified as an answer and its agreement notes may name only invited
  specialties; a lower synthesis urgency is never applied over the checker's read.
- Archiving a profile flips `patient_profiles.archived_at` only; it never deletes sources,
  facts, observations, audit rows, or storage objects.
- Synthetic data only, in fixtures, tests, screenshots, and logs. Never commit real medical
  documents or secrets.
- New dependencies must satisfy `config/license-policy.json` and be recorded in
  `THIRD_PARTY_NOTICES.md`; `pnpm license:check` enforces it.
