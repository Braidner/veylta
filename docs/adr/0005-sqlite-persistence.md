# ADR 0005: Embedded SQLite persistence for the local slice

- Status: Accepted
- Date: 2026-08-12
- Supersedes: the database selection and job-persistence portions of ADR 0001

## Context

The first vertical slice is a synthetic, single-host application. It needs
durable relational state, explicit migrations, tenant-aware constraints,
transactional idempotency/audit writes, and a database shared by the API and
worker processes. Requiring a separate database server and container adds
operational and dependency surface before the product has demonstrated a need
for horizontal database scaling.

Node.js 22 already supplies SQLite through `node:sqlite`, so the repository can
meet the current requirements without an ORM, native npm database binding, or
external database service.

## Decision

Use one local SQLite database selected by `DATABASE_PATH`, defaulting to
`.local/family-health.sqlite`. Keep SQL behind the small application-owned
database adapter and keep ordered up/down migrations in `db/migrations`.

Every connection enables:

- `PRAGMA foreign_keys = ON`;
- `PRAGMA busy_timeout = 5000`;
- `PRAGMA journal_mode = WAL`;
- `PRAGMA synchronous = NORMAL`.

The adapter serializes operations inside each process. Domain write operations
use `BEGIN IMMEDIATE`, commit on success, and roll back on failure. This acquires
the SQLite write reservation before idempotency and deduplication decisions are
made. The API and worker remain separate runtime entries and open the same local
file. Through Task 4 the worker only checks readiness; Task 5 adds durable job
polling against this database.

SQLite stores RFC 3339 timestamps and JSON metadata as validated `TEXT` values.
Foreign keys, composite tenant keys, uniqueness, checks, and triggers remain
database-enforced rather than being delegated solely to TypeScript.

## Consequences

### Positive

- Local startup needs Node.js only; no database container, credentials, port,
  or extra runtime package is required.
- One portable file keeps synthetic development state across restarts.
- SQLite transactions and constraints are sufficient for the current tenant,
  session, upload, idempotency, deduplication, and audit invariants.
- Using the Node.js-bundled runtime keeps the npm license/dependency boundary
  smaller.

### Negative

- Writes are serialized, and storage finalization during Task 4 holds the write
  reservation for the bounded local operation.
- A local file does not support independently scaled API/worker hosts or the
  operational tooling of a managed database service.
- WAL and the main database file must be handled as one persistence set during a
  safe backup/checkpoint procedure; production backup/restore is not implemented.
- File permissions and disk encryption are deployment responsibilities and are
  mandatory before real medical data is allowed.

## Rejected alternatives

- **External PostgreSQL now:** proven and scalable, but adds a service,
  credentials, networking, container provenance, and test lifecycle that the
  local synthetic slice does not need.
- **In-memory SQLite:** loses restart persistence and invalidates the product
  acceptance path.
- **ORM or native SQLite npm binding:** adds abstraction/dependency surface
  without a current domain requirement.
- **Database BLOB storage:** violates the versioned object-storage boundary and
  couples immutable evidence bytes to structured-state backups.

## Review triggers

Revisit the persistence engine when multi-host deployment is required, measured
write contention exceeds the local budget, job load interferes with requests, a
managed high-availability database becomes an operational requirement, or a
verified migration/backup strategy for real data demands a different engine.
Do not place this SQLite database on an unreviewed shared network filesystem as
a shortcut around those triggers.
