# Veylta

Veylta is an open-source, family-first medical record for keeping source
documents, reviewing extracted laboratory facts, and following confirmed
measurements over time.

The coined name evokes a protective *veil*: private by default, with every
derived claim still traceable to its source. It is pronounced “VAYL-ta”.

The product helps a family understand its own health history and prepare for a
conversation with a clinician. It does **not** diagnose disease, prescribe or
change treatment, or replace a clinician or an electronic health record.

## Project status

The repository is implementing its first vertical slice. The completed local
path creates an opaque synthetic demo session, one owner-scoped family,
adult/dependent profiles, immutable synthetic PDF/PNG/JPEG records, review-ready
extracted facts, and explicit review decisions in persistent local storage.
The full first slice remains deliberately narrow:

1. create a family and a patient profile;
2. upload a fully synthetic Russian-language text-layer report or a bounded
   image-only scan using the fixed local-English synthetic fallback grammar;
3. persist the immutable original and calculate its SHA-256 while streaming;
4. detect a possible duplicate within that family;
5. deterministically extract a small, versioned set of laboratory facts with
   provenance and a durable local job;
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

Cloud OCR, LLM processing, clinical trend summaries, recommendations, FHIR
exchange, production export/backup, and the rest of the full MVP are explicitly deferred.
In the loopback-local synthetic demo, an owner can issue a one-time invitation
to an adult or caregiver. An adult receives only a personal linked profile;
a caregiver receives no profile at all until the owner explicitly grants the
single, revocable `profile.read` capability for one profile. The grant never
transfers upload, review, invitation, or family-audit powers. This is not
production identity or consent management. The optional S3-compatible storage
adapter is implemented only for synthetic operator testing and is not a
real-data readiness claim.

## Product principles

- Family-first access with explicit per-profile grants.
- Privacy-first processing and no external medical-data transfer by default.
- Source-first, immutable originals and complete provenance.
- Explicit human review before any extracted fact becomes a medical observation.
- Explainable outputs; no opaque health score.
- Portable data and provider-independent storage, OCR, and LLM boundaries.
- Synthetic fixtures only. Never commit real medical documents or secrets.

## Intended architecture

- TypeScript monorepo without an orchestration framework.
- Next.js web application.
- Fastify API and worker process.
- Embedded SQLite through Node.js `node:sqlite` for domain state, audit events,
  explicit migrations, and—beginning with Task 5—durable idempotent jobs.
- Versioned `ObjectStorage/v1` contract, backed by a persistent local filesystem
  directory by default and an explicit S3-compatible encrypted adapter for
  synthetic deployments. Controlled reads take a bounded, checksum-verified
  snapshot (the current synthetic-document cap is 5 MiB) before returning bytes.
- Versioned deterministic parser for the first synthetic document format. When
  a PDF text layer is absent, the worker may run a local, bounded English OCR
  model on rendered PDF pages; direct PNG/JPEG inputs use that same bounded
  local path after signature and header-pixel checks. It never calls an
  OCR/LLM provider.

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
The browser flow at <http://127.0.0.1:4300> creates a local demo family and
keeps the active profile explicit in both the route and heading. It accepts one
synthetic PDF, PNG, or JPEG up to 5 MiB, streams it through matching
MIME/signature, size, and SHA-256 checks, and
keeps it below `OBJECT_STORAGE_ROOT` across restarts. A repeated checksum is
reported only inside the same family; it creates another logical document but
not another blob. Source download is authorized again and returned as a safe
attachment. The worker polls the same SQLite file and processes the checked-in
synthetic PDF grammar through PDF.js and a strict deterministic parser. For an
image-only PDF it renders at most three bounded pages; direct PNG/JPEG uses the
same local English OCR model after a header pixel-cap check. Every OCR output
still has to satisfy the exact synthetic grammar; there is no OCR/LLM network call or provider
URL. Extracted facts are proposals
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
at most three recent immutable sources, three pending-review sources, and three
explicitly confirmed values with links back to the original document. It is an
operational overview, never a clinical summary, and its successful read is
payload-free audited. Its owner/self-only `synthetic-evidence-bundle/v1` download
is a bounded TAR snapshot of five latest synthetic sources and their checksummed
manifest, never a backup, restore format, or production portability claim. The demo never asks for a real email. The opaque session token exists only in
an HttpOnly cookie; SQLite stores its SHA-256 digest. Demo registration is
disabled by default; the root `pnpm dev` and E2E runner enable it explicitly
while both web and API bind only to loopback.
`DEMO_REGISTRATION_ENABLED=true` is rejected with a non-loopback `API_HOST`, and
state-changing requests require the exact configured `WEB_ORIGIN`.

An artifact can be checked without extracting it to disk:

```bash
pnpm --filter @veylta/api verify:evidence-bundle ./veylta-synthetic-evidence.tar
```

The verifier accepts only the local `synthetic-evidence-bundle/v1` USTAR shape,
generated document paths, supported source signatures, and matching SHA-256/size
metadata. It proves structural consistency of the captured local archive, not
its origin, clinical correctness, or a production export guarantee. It prints
counts only; it never calls the API, writes archive entries, or logs profile
names, filenames, values, or source bytes.

This demo session has no login or account recovery and is not production
authentication. Integration tests create isolated temporary SQLite databases;
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
