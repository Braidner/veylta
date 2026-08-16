# Veylta

Veylta is an open-source, family-first medical record for keeping source
documents, reviewing extracted laboratory facts, and following confirmed
measurements over time.

The coined name evokes a protective *veil*: private by default, with every
derived claim still traceable to its source. It is pronounced “VAYL-ta”.

The product helps a family understand its own health history and prepare for a
conversation with a clinician. It does **not** diagnose disease, prescribe or
change treatment, or replace a clinician or an electronic health record.

## Product direction: a home health-care PWA

Veylta is an installable PWA served by one home installation, in the same
operational style as BraidnerAssist. Fastify and the worker own a local SQLite
database and a configurable document-storage directory. There is no Veylta
cloud control plane and no serverless custody model: accounts, access grants,
medical metadata, audit events, and jobs stay on the household server.

On an empty installation the only available product action creates the first
administrator, their home workspace, and their linked health profile in one
transaction. Later sign-in uses a local username and password. The target
settings surface manages Codex connection status, the live local model catalog,
reasoning/Fast execution profile, subscription limit windows, document-storage location,
local administrator/user accounts, and per-profile access.

The Codex integration follows Hermes' proven local-runtime pattern:
Veylta checks and starts a locally installed `codex app-server` daemon, while
bounded document-intelligence and proposal jobs run through `codex exec --ephemeral` using the same
ChatGPT subscription session owned by `codex login`. Veylta never reads, copies,
or persists Codex OAuth tokens or API keys, and refuses proposals unless Codex
confirms ChatGPT authentication. See
[ADR 0007](docs/adr/0007-home-server-pwa-and-codex-runtime.md).

Document detail also supports up to 20 named, persistent Russian Codex
conversations bound to that document. Each turn resumes its conversation's
local Codex thread and receives a fresh loopback-only MCP capability for the
exact authorized document. The same workspace lists real processing jobs
separately as ephemeral Codex runs, so a background analysis is never presented
as saved dialogue. The first tool surface is
read-only: Codex can inspect current metadata, processing state, and
source-bound facts, but cannot access SQLite/filesystem directly or confirm a
medical fact for the user. No LangGraph or frontend chat framework is needed.
The same document surface shows an append-only processing journal per run. It renders
only real server transitions and never imitates token streaming. For a failed run it also
shows the owner the diagnostic record of that attempt: the bounded request Veylta sent, the
raw answer Codex returned, and the closed reason code that refused it. That record is
reachable only through the same profile authorization as the document itself, and it is
never copied into an audit event, worker log, or metric — those remain payload-free.

## Project status

The repository contains the source-first synthetic record path and is now
moving it behind the home-server account model. The completed first-run path
creates exactly one local administrator, one owner-scoped home workspace,
adult/dependent profiles, immutable synthetic PDF/PNG/JPEG records, review-ready
extracted facts, and explicit review decisions in persistent local storage.
The full first slice remains deliberately narrow:

1. create a family and a patient profile;
2. batch-upload up to twenty fully synthetic PDF, PNG, or JPEG documents;
3. persist the immutable original and calculate its SHA-256 while streaming;
4. reuse the existing active logical document for an identical SHA-256 in the
   same profile while keeping family-scoped physical deduplication private;
5. let Codex produce, in one bounded call, a Russian short summary, Russian
   detailed summary, source-provenanced generic results (including genetic and
   categorical findings), and compatible quantitative laboratory facts;
6. explicitly confirm, correct, or reject those facts; a confirmation or
   correction creates a source-linked observation without changing the raw
   extraction (Task 6, delivered);
7. show confirmed observations as indicator history with provenance back to
   the document and page (Task 7, delivered);
8. compare compatible, confirmed synthetic indicators by exact code and source
   unit, with an accessible chart and no clinical assessment (Task 9,
   delivered).
9. let the family owner inspect a paginated, payload-free activity log; it
   exposes only action, result, time, actor, and resource selector (Task 12,
   delivered).
10. open a compact profile overview of bounded recent source documents, pending
    explicit reviews, and confirmed values, without a health score, diagnosis,
    or recommendation (Task 17, delivered).
11. download a local TAR snapshot of at most five latest synthetic source files
    plus their checksummed manifest, only as the owner/self profile actor (Task 18,
    delivered).
12. verify a downloaded local synthetic snapshot offline, before any manual
    handling of its contents (Task 19, delivered).
13. open a versioned, evidence-backed profile summary assembled only after
    explicit fact review; it labels missing context and offers only source
    preparation or pending-review actions, never diagnosis, triage, or treatment
    advice (Task 20, delivered).
14. browse any earlier immutable version of that evidence-backed summary, with
    its original source set and no derived "change" claim (Task 21, delivered).
15. explicitly inspect which confirmed source records entered or did not enter
    two saved summary versions, without turning that difference into a health
    assessment (Task 22, delivered).
16. reversibly archive a non-last profile as the family owner, immediately
    hiding its sources from active navigation and worker claims without deleting
    originals, extracted facts, observations, or storage objects; the owner can
    restore it later (Task 24, delivered).
17. keep one profile-scoped household care plan for analyses, clinicians,
    nutrition, activity, and reminders. A person-authored item is visibly a
    decision, not a source-derived recommendation. After a separate disclosure,
    Codex may select bounded drafts from the latest confirmed summary; every
    draft is provenance-locked and remains `proposed` until a person decides
    (Tasks 33a/33b, delivered).
18. follow real document-processing stages after reload and hold named,
    independent Russian Codex dialogues scoped to that exact authorized
    document. The UI separates those saved dialogues from ephemeral analysis
    runs and waits for a complete validated response instead of simulating a
    token stream (Tasks 37/38, delivered; multi-dialogue workspace extended).
19. search locally across the latest summaries and structured results, download
    verified original bytes under the original display filename, and
    idempotently remove a document from every active read without claiming
    physical backup erasure (Tasks 39/40, delivered).

Cloud OCR, clinically validated recommendations, FHIR
exchange, production backup/restore, and the rest of the full MVP are explicitly deferred.
The old loopback demo registration remains test-only. In that synthetic test path, an owner can issue a one-time invitation
to an adult or caregiver. An adult receives only a personal linked profile;
a caregiver receives no profile at all until the owner explicitly grants the
single, revocable `profile.read` capability for one profile. The grant never
transfers upload, review, invitation, or family-audit powers. This is not
production identity or consent management. The optional S3-compatible storage
adapter is implemented only for synthetic operator testing and is not a
real-data readiness claim.

## Product principles

- Family-first access with explicit per-profile grants.
- Privacy-first processing with explicit disclosure before document content is
  sent through the household's Codex subscription.
- Source-first, immutable originals and complete provenance.
- Explicit human review before any extracted fact becomes a medical observation.
- Explainable outputs; no opaque health score.
- Portable data and provider-independent storage, OCR, and LLM boundaries.
- Synthetic fixtures only. Never commit real medical documents or secrets.

## Current executable architecture

- TypeScript monorepo without an orchestration framework.
- Next.js web application.
- Fastify API and worker process.
- Embedded SQLite through Node.js `node:sqlite` as the authoritative household
  store for accounts, access, domain state, audit events,
  explicit migrations, and—beginning with Task 5—durable idempotent jobs.
- Versioned `ObjectStorage/v1` contract, backed by a persistent local filesystem
  directory by default and an explicit S3-compatible encrypted adapter for
  synthetic deployments. Controlled reads take a bounded, checksum-verified
  snapshot (the current synthetic-document cap is 5 MiB) before returning bytes.
- Provider-neutral `DocumentIntelligenceProvider` boundary with a Codex CLI
  implementation. A PDF text layer travels as text; a scanned PDF or a direct
  PNG/JPEG travels as bounded page images that Codex transcribes itself.
  Codex classifies the document and returns a closed, source-bound schema.
  Results are rejected unless every fact cites an exact source fragment of the
  page text — the text layer, or the model's own transcription for an image.
  Verification is per item: an unbound fact or summary result is dropped and
  the verified rest is kept; a laboratory answer whose facts miss most of its
  own numeric measurements is refused as incomplete so the retry asks again.
  A model-proposed normalization is kept only when it repeats the printed
  number under a canonical unit spelling — Veylta performs no unit conversions.
  No local OCR engine is installed.
- A seeded analyte catalog (~95 common blood-count, chemistry, hormone and
  coagulation analytes with a canonical unit and Russian/Latin printed
  spellings) travels with every request as `knownAnalytes`, so codes are
  proposed from a closed list; the same aliases map stored facts
  deterministically by normalized name + unit, and Cyrillic and Latin unit
  spellings («г/л», `g/L`) share one key. Codes are household identifiers,
  not a clinical vocabulary.
- `document-agent/v2` stores named append-only Russian conversations and exact
  Codex model/runtime provenance in SQLite, while processing runs stay
  explicitly ephemeral. The official MCP SDK exposes one short-lived,
  document-scoped read-only context tool to the local Codex CLI.
- `document/v5` exposes an ordered payload-free timeline for the latest job
  and immutable review summaries with the deciding account and decision time;
  the web UI polls and renders only persisted queue/stage/result events.
- The document workspace keeps one selected result in context: it shows the
  exact page/fragment beside that result, clear missing-field disclosure, and
  only the applicable human actions (confirm, correct, or reject). Bulk
  confirmation includes only facts with no extraction warnings; `needs_review`
  facts always require an individual source check. Every accepted bulk item is
  still stored as its own explicit immutable decision.
- Versioned `home-care-plan/v1` read/write boundary backed by tenant-aware
  SQLite constraints. User actions are replay-safe and retained; a future
  Codex proposal must name its immutable summary, rule version, source when
  applicable, and missing context before the UI can show it.

See [product](docs/product.md), [architecture](docs/architecture.md),
[threat model](docs/threat-model.md), [API](docs/api.md), [ER model](docs/er-model.md),
[slice plan](docs/slices.md), and the
[first-slice acceptance evidence](docs/first-slice-acceptance.md).

## Local development

Node.js 22.16+ is required. No database server or container runtime is needed.
Start the current runnable foundation from the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The web app listens on port `4300` on every network interface and is available
locally at <http://127.0.0.1:4300>. The API remains at
<http://127.0.0.1:4301>, and worker health remains at
<http://127.0.0.1:4302>. `pnpm dev` starts all three application processes.
Browser origins are denied unless they appear exactly in `WEB_ORIGINS`; to use
the app from the local network, copy `.env.example` to `.env`, replace its
example LAN address with the server's current address, and open
`http://<server-lan-address>:4300`. Structured state remains in
`.local/veylta.sqlite` and document bytes remain below `.local/storage`
across process restarts. The SQLite connection enables foreign keys, a bounded
busy timeout, and WAL mode. Defaults match `.env.example`; copy it to `.env`
only when a local override is needed.

Install Chromium once before the browser test, then run the complete scaffold
checks:

```sh
pnpm exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
pnpm license:check
```

`pnpm db:rollback` reverses the latest migration; `pnpm db:migrate` reapplies it.
On first launch, <http://127.0.0.1:4300> creates the only bootstrap administrator
and signs them into their linked profile. Later visits show the local sign-in
screen. The active profile stays explicit in both the route and heading. The
batch dialog accepts up to twenty synthetic PDF, PNG, or JPEG files of 5 MiB
each and streams each through matching
MIME/signature, size, and SHA-256 checks, and
keeps it below `OBJECT_STORAGE_ROOT` across restarts. A repeated checksum is
reported only inside the same family; it creates another logical document but
not another blob. Source download is authorized again and returned as a safe
attachment. The worker polls the same SQLite file and uses PDF.js to read the
text layer. For an image-only PDF it renders at most three bounded pages to PNG;
a direct PNG/JPEG passes a header and pixel-cap check and is used as one page
image. After explicit UI disclosure, page text — or the page images — is sent
to the locally authenticated Codex CLI, which transcribes any image page before
extracting from it. Codex
classifies and distributes documents into archive sections, while a strict
post-validator rejects invented or unbound facts. Extracted facts are proposals
for review, never confirmed medical observations by themselves. A user
confirmation or correction creates one immutable review decision and confirmed
observation in the same transaction; a rejection creates no observation. The
raw extracted fact is never edited. The profile page then lists confirmed
observations source-first, with their document-specific provenance and an
authorized link back to the immutable original. Its separate compatible-
indicator view keeps exact source units apart and can show the arithmetic
difference between the latest two numeric sources; it never assigns a
reference-range meaning, clinical trend, or recommendation.

The profile landing view is an authorized `profile-overview/v1` read: it shows
at most fifty recent immutable sources, three pending-review sources, and three
explicitly confirmed values with links back to the original document. It is an
operational overview, never a clinical summary, and its successful read is
payload-free audited. Its owner/self-only `synthetic-evidence-bundle/v1` download
is a bounded TAR snapshot of five latest synthetic sources and their checksummed
manifest, never a backup, restore format, or production portability claim. The
separate `synthetic-profile-export/v1` download contains every current source and
confirmed observation for one profile when the profile has at most ten sources;
it fails closed rather than omitting older data. It is a local synthetic export,
not a restore or production backup. Account setup asks for no email and stores a
versioned scrypt password hash. The opaque session token exists only in an
HttpOnly cookie; SQLite stores its SHA-256 digest. Demo registration is disabled
by default and enabled only by the E2E runner for legacy synthetic scenarios.
The web proxy can accept trusted LAN clients, while the API, worker health
endpoint, and document-agent MCP transport remain bound to loopback.
`DEMO_REGISTRATION_ENABLED=true` is rejected when either the API or any trusted
web origin is non-loopback, and state-changing requests require an exact match
in the configured `WEB_ORIGINS` allowlist.

An owner can also use the explicit `profile-archive/v1` workflow to hide a
non-last active profile. Archiving changes only the profile's reversible access
state: it removes the profile and every direct document read from active
authorization, and pending worker jobs are not claimed until the owner restores
the profile. It does not delete or rewrite immutable sources, raw facts,
confirmed observations, audit events, or storage objects. This narrow local
feature is not account deletion, retention management, backup, disaster
recovery, or production restoration.

Once every fact in an extraction run has its explicit final decision, the
profile can also open `health-summary/v1`. It is an immutable, bounded snapshot
of confirmed observations with re-authorized links back to their source. It
marks evidence new since the prior snapshot and missing context, but does not
infer a condition, risk, red flag, trend, or treatment. Its only deterministic
next actions are to prepare sources for a clinician or complete another pending
review. `health-summary-history/v1` lists those immutable versions newest-first;
selecting one reopens its exact stored source set. It never compares versions or
derives a clinical or non-clinical health conclusion from their difference.
When two versions are selected for an explicit source-set comparison, Veylta
lists only confirmed source records newly included or no longer included. It
does not compute an improvement, decline, trend, diagnosis, or recommendation.

An artifact can be checked without extracting it to disk:

```bash
pnpm --filter @veylta/api verify:evidence-bundle ./veylta-synthetic-evidence.tar
# The same command also recognizes veylta-synthetic-profile.tar.
```

The verifier accepts only the local `synthetic-evidence-bundle/v1` and
`synthetic-profile-export/v1` USTAR shapes, generated document paths, supported
source signatures, and matching SHA-256/size metadata. It proves structural
consistency of the captured local archive, not its origin, clinical correctness,
or a production export guarantee. It prints counts only; it never calls the API,
writes archive entries, or logs profile names, filenames, values, or source bytes.

Local username/password sign-in and first-administrator bootstrap are delivered;
password recovery, passkeys, remote exposure, and hardened multi-device session
management are not. Integration tests create isolated temporary SQLite databases;
they do not reset the default development file. The upload path is also
limited to PDF signature, MIME, size, immutable-storage, and authorization
controls. The checked-in fixture, tests, and supported deterministic parser are
synthetic-only; the demo is not a technical detector for real medical content.
Do not upload real medical data until all production gates in the threat model
are complete and independently reviewed.

## Safety and data policy

Only synthetic medical data belongs in source control, fixtures, screenshots,
logs, telemetry, and public tests. Local development is not production-ready
for real medical data. Do not claim compliance with medical, privacy, or legal
standards without a separate audit.

## License

Veylta's original code and documentation are licensed under the
[MIT License](LICENSE). Dependency and integration rules are defined in
[docs/license-policy.md](docs/license-policy.md).
