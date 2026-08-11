# Family Health

Family Health is an open-source, family-first medical record for keeping source
documents, reviewing extracted laboratory facts, and following confirmed
measurements over time.

The product helps a family understand its own health history and prepare for a
conversation with a clinician. It does **not** diagnose disease, prescribe or
change treatment, or replace a clinician or an electronic health record.

## Project status

The repository is at the foundation and first-vertical-slice stage. The first
slice is deliberately narrow:

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

The runnable scaffold is part of the next task in the first-slice plan. Its
required developer contract is:

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The exact commands above must be verified and kept current when the manifests,
Compose services, and migrations are added. Until then, this documentation-only
foundation is not a runnable application.

The completed slice must also expose these checks:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm license:check
```

## Safety and data policy

Only synthetic medical data belongs in source control, fixtures, screenshots,
logs, telemetry, and public tests. Local development is not production-ready
for real medical data. Do not claim compliance with medical, privacy, or legal
standards without a separate audit.

## License

Family Health's original code and documentation are licensed under the
[MIT License](LICENSE). Dependency and integration rules are defined in
[docs/license-policy.md](docs/license-policy.md).
