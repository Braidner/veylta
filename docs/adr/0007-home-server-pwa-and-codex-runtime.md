# ADR 0007: Home-server PWA, local accounts, and Codex runtime

- Status: Accepted
- Date: 2026-08-13
- Supersedes: ADR 0006 as the target product architecture

## Context

The synchronized-vault direction in ADR 0006 split authority between browser
capabilities, portable files, a loopback bridge, and an agent skill. That model
made household accounts, predictable background work, profile sharing, storage
relocation, and recovery harder than this product needs.

Veylta should behave like a home service: one household controls one
installation, opens an installable web app on its devices, and keeps structured
state and source documents on that server. Codex is optional and should use the
household's existing ChatGPT/Codex subscription without asking Veylta to own an
API key or OAuth refresh token.

## Decision

1. The target runtime is an installable Next.js PWA backed by a Fastify API,
   worker, one authoritative SQLite database, and a configurable local object
   storage root. There is no Veylta-hosted control plane and no browser-owned
   vault as the source of truth.
2. An empty database exposes a one-time setup action. It atomically creates the
   first `admin` account, household workspace, owner membership, linked adult
   profile, session, and payload-free audit events. Every later session starts
   with local username/password sign-in.
3. System roles are `admin` and `user`. The target profile boundary admits an
   active administrator, the linked owning user, or an actor with an explicit
   revocable profile grant. URL identifiers remain selectors, never authority.
4. Settings will own account administration, profile grants, Codex runtime
   connection, and a guarded storage-location migration. Changing the storage
   path must copy, checksum-verify, switch atomically, and retain recovery state;
   it must never reinterpret a typed path as proof that data moved safely.
5. The optional Codex adapter starts or connects to local `codex app-server`.
   Authentication remains owned by `codex login` and the Codex home directory.
   Veylta stores only non-secret connection preferences and health/status data;
   it never parses, copies, logs, or persists Codex OAuth credentials.
6. Agent work is explicit, least-privilege, auditable, and profile-scoped. Raw
   documents may leave the home server only after a user-visible disclosure and
   action. Human review remains mandatory before proposals become observations.

## Consequences

- SQLite transactions enforce setup, accounts, grants, jobs, review, and audit
  invariants in one authority boundary.
- The PWA remains installable on the home network, but offline shell availability
  does not imply offline medical-data caching.
- A household backup must cover both the SQLite file and object-storage root.
- Remote exposure, TLS, password recovery, passkeys, encrypted backup, and
  multi-host operation need separate designs before real-data readiness.
- `codex app-server` is experimental. Its protocol stays behind a small
  replaceable port with capability detection and fail-closed behavior.
- ADR 0006 and the vault artifacts are historical, not the target architecture.

## Rejected alternatives

- **Browser-owned synchronized folder as the primary database:** too many
  authorities and conflict modes for household accounts and durable work.
- **Veylta-managed OpenAI API key:** adds secret custody and separate token
  billing when the local Codex runtime can use the user's subscription.
- **Reading `~/.codex/auth.json` directly:** couples Veylta to private token
  formats and creates unnecessary credential exposure.
- **PostgreSQL or a hosted database:** operationally excessive for one home;
  SQLite provides the required transactional model.
