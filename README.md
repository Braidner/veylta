# Family Health

Family Health is an open-source, family-first medical record for keeping source
documents, reviewing extracted laboratory facts, and following confirmed
measurements over time.

The product helps a family understand its own health history and prepare for a
conversation with a clinician. It does **not** diagnose disease, prescribe or
change treatment, or replace a clinician or an electronic health record.

## Project status

The repository is implementing its first vertical slice. The completed local
path currently creates an opaque synthetic demo session, one owner-scoped
family, and multiple adult/dependent profiles. The full first slice remains
deliberately narrow:

1. create a family and a patient profile;
2. upload a fully synthetic Russian-language PDF with a text layer;
3. persist the immutable original and calculate its SHA-256 while streaming;
4. detect a possible duplicate within that family;
5. deterministically extract a small, versioned set of laboratory facts;
6. review and confirm or correct those facts;
7. show confirmed observations with provenance back to the document and page.

S3-compatible storage, OCR, LLM processing, trend summaries, recommendations,
FHIR exchange, export/backup, and the rest of the full MVP are explicitly
deferred. They must not be represented as implemented until their own slices
are complete.

## Product principles

- Family-first access with explicit per-profile grants.
- Privacy-first processing and no external medical-data transfer by default.
- Source-first, immutable originals and complete provenance.
- Human review before uncertain extracted facts become medical observations.
- Explainable outputs; no opaque health score.
- Portable data and provider-independent storage, OCR, and LLM boundaries.
- Synthetic fixtures only. Never commit real medical documents or secrets.

## Intended architecture

- TypeScript monorepo without an orchestration framework.
- Next.js web application.
- Fastify API and worker process.
- PostgreSQL for domain state, audit events, explicit migrations, and durable
  idempotent background jobs.
- Versioned `ObjectStorage/v1` contract, initially backed by a persistent local
  filesystem directory.
- Versioned deterministic parser for the first synthetic document format; no
  LLM or OCR is used in the first slice.

See [product](docs/product.md), [architecture](docs/architecture.md),
[threat model](docs/threat-model.md), [API](docs/api.md), [ER model](docs/er-model.md),
and [slice plan](docs/slices.md).

## Local development

Node.js 22.13+ and Docker are required. Start the current runnable foundation
from the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The web app is available at <http://127.0.0.1:4300>, the API at
<http://127.0.0.1:4301>, and worker health at <http://127.0.0.1:4302>. `pnpm dev`
starts all three application processes; PostgreSQL data and `.local/storage`
remain persistent across process restarts. Defaults match `docker-compose.yml`;
copy `.env.example` only when a local override is needed.

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
keeps the active profile explicit in both the route and heading. It never asks
for a real email. The opaque session token exists only in an HttpOnly cookie;
PostgreSQL stores its SHA-256 digest. Demo registration is disabled by default;
the root `pnpm dev` and E2E runner enable it explicitly while both web and API
bind only to loopback. `DEMO_REGISTRATION_ENABLED=true` is rejected with a
non-loopback `API_HOST`, and state-changing requests require the exact configured
`WEB_ORIGIN`.

This demo session has no login or account recovery and is not production
authentication. Integration tests reset the local synthetic family tables, so
run them only against the documented development database. Document upload and
all real medical data remain disabled until their later tested tasks land.

## Safety and data policy

Only synthetic medical data belongs in source control, fixtures, screenshots,
logs, telemetry, and public tests. Local development is not production-ready
for real medical data. Do not claim compliance with medical, privacy, or legal
standards without a separate audit.

## License

Family Health's original code and documentation are licensed under the
[MIT License](LICENSE). Dependency and integration rules are defined in
[docs/license-policy.md](docs/license-policy.md).
