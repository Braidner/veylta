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
settings surface manages Codex connection status, document-storage location,
local administrator/user accounts, and per-profile access.

The Codex integration follows Hermes' proven local-runtime pattern:
Veylta checks and starts a locally installed `codex app-server` daemon, while
bounded document-intelligence and proposal jobs run through `codex exec --ephemeral` using the same
ChatGPT subscription session owned by `codex login`. Veylta never reads, copies,
or persists Codex OAuth tokens or API keys, and refuses proposals unless Codex
confirms ChatGPT authentication. See
[ADR 0007](docs/adr/0007-home-server-pwa-and-codex-runtime.md).

Document detail also supports one persistent Russian Codex conversation. Each
turn resumes its local Codex thread and receives a fresh loopback-only MCP
capability for the exact authorized document. The first tool surface is
read-only: Codex can inspect current metadata, processing state, and
source-bound facts, but cannot access SQLite/filesystem directly or confirm a
medical fact for the user. No LangGraph or frontend chat framework is needed.

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
4. detect a possible duplicate within that family;
5. let Codex classify every document into a bounded archive category and extract
   only source-bound quantitative laboratory facts through a provider-neutral port;
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
  implementation. Local bounded PDF/OCR transport produces page evidence;
  Codex classifies the document and returns a closed, source-bound schema.
  Results are rejected unless every fact cites an exact source fragment.
- `document-agent/v1` stores an append-only Russian conversation and exact
  Codex model/runtime provenance in SQLite. The official MCP SDK exposes one
  short-lived, document-scoped read-only context tool to the local Codex CLI.
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

The web app is available at <http://127.0.0.1:4300>, the API at
<http://127.0.0.1:4301>, and worker health at <http://127.0.0.1:4302>. `pnpm dev`
starts all three application processes. Structured state remains in
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
attachment. The worker polls the same SQLite file and uses PDF.js plus bounded
local OCR to produce page evidence. For an
image-only PDF it renders at most three bounded pages; direct PNG/JPEG uses the
same local English OCR model after a header pixel-cap check. After explicit UI
disclosure, page content is sent to the locally authenticated Codex CLI. Codex
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
by default and enabled only by the E2E runner for legacy synthetic scenarios,
while both web and API bind only to loopback.
`DEMO_REGISTRATION_ENABLED=true` is rejected with a non-loopback `API_HOST`, and
state-changing requests require the exact configured `WEB_ORIGIN`.

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
