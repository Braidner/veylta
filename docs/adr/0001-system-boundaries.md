# ADR 0001: System boundaries and API framework

- Status: Accepted
- Date: 2026-08-11

## Context

Family Health needs a TypeScript web UI, a separately enforceable server-side
authorization boundary, asynchronous document processing, PostgreSQL, and room
for future provider adapters. The first slice must remain small and runnable,
without moving business rules into React or adopting a heavy platform.

## Decision

Use pnpm workspaces with only these initial workspaces:

- `apps/web`: Next.js UI;
- `apps/api`: Fastify HTTP entry plus a separate worker runtime entry in the
  same artifact, reusing the same application/domain services;
- `packages/contracts`: versioned transport and extraction schemas shared by
  web and API.

The API and worker run as separate processes. The worker polls durable jobs in
PostgreSQL; it is not a separate package or independently versioned service.
Fastify is the API framework because its small core, streaming request support,
and schema-oriented validation suit the first slice. PostgreSQL is the source of
truth for structured state, explicit migrations, audit events, and jobs.

Domain rules live in framework-independent modules inside `apps/api` until a
second real consumer justifies extraction. The UI renders and submits state but
does not own authorization, medical validation, or processing transitions.

Every server request and worker operation is tenant-scoped. An authenticated
identity alone is insufficient: the API verifies family membership, profile
access/consent, capability, and resource state. Inaccessible resource IDs return
a non-disclosing response.

## Consequences

### Positive

- One language and one contract package keep the first slice understandable.
- Fastify makes streaming and strict JSON-schema boundaries explicit.
- API and worker reuse code without inventing another service/package.
- Separate runtime processes preserve independent scaling and failure isolation.
- Postgres-backed jobs avoid a second broker and still provide durable retry,
  idempotency, leases, and dead-letter state.

### Negative

- API and worker deploy from one artifact and cannot evolve independently.
- PostgreSQL bears both request and job load; queue behavior must be monitored.
- Framework-independent domain discipline is a code-review convention until a
  separate domain package becomes justified.
- Next.js and Fastify require an explicit browser-to-API integration rather than
  relying on one full-stack runtime.

## Rejected alternatives

- **NestJS:** capable, but its module/decorator surface is unnecessary for the
  first slice.
- **Next.js routes as the only API:** blurs tenant authorization, streaming, and
  worker boundaries.
- **Separate `apps/worker` workspace:** duplicates packaging before the worker
  has an independent domain or release lifecycle.
- **Redis/RabbitMQ/Kafka queue:** adds infrastructure before demonstrated need.
- **Nx/Turbo:** adds orchestration that pnpm scripts can cover at this scale.
- **Heavy FHIR platform:** premature; use a compact FHIR-inspired model and add
  FHIR R4 mapping at the edges later.

## Review triggers

Revisit when API/worker require independent release cadence, job traffic harms
transactional workloads, another domain consumer exists, or FHIR interoperability
requirements are concrete enough to justify a new boundary.
