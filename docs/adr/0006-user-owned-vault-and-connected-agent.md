# ADR 0006: User-owned vault and explicitly connected agent

- Status: Accepted as the target architecture
- Date: 2026-08-13
- Supersedes: the long-term persistence and agent-connectivity direction in ADR 0001, ADR 0004, and ADR 0005

## Context

The completed synthetic slice proves source immutability, extraction review,
provenance, profile history, and a useful health cockpit. Its Fastify, SQLite,
worker, and object-storage runtime nevertheless makes Veylta the custodian of a
family's data when deployed as a service.

The product should instead let a person keep the primary record in a folder
they own, including a folder already synchronized by iCloud Drive, Google
Drive, Dropbox, or another desktop sync provider. Veylta should be an
installable PWA over that portable record. An optional Codex skill should work
like the Takt/Impeccable live bridge: it connects only after an explicit user
action, leases narrow commands, and writes versioned results back to the same
vault.

Browser directory access is not universal. `showDirectoryPicker()` is a
limited-availability API, requires a user gesture, and a retained handle may
need permission again. Origin-private browser storage is not an acceptable
substitute because it is neither a user-visible folder nor independently
portable.

## Decision

### Portable vault

Adopt `veylta-vault/v1` as the provider-neutral source of truth. The selected
root contains relative paths, immutable originals, JSON manifests, derived
runs, review decisions, observations, agent commands, and an append-only audit
journal. Every original manifest records media type, byte size, and SHA-256.
Derived data identifies the exact source checksum and never rewrites the
original.

The portable vault never stores OAuth credentials, API keys, Codex secrets,
local bridge tokens, absolute machine paths, or browser directory handles.
Those remain in provider/browser/OS-local state.

The initial layout is documented in [vault format](../vault-format.md). JSON
writes use a temporary sibling followed by an atomic replacement where the
adapter supports it. New schema versions require an explicit migration; readers
fail closed on an unknown major version.

### PWA storage adapters

The web application depends on a small `VaultAdapter`, not SQLite or a cloud
provider SDK.

1. `directory`: on a supporting desktop browser, the user explicitly chooses a
   dedicated Veylta folder. The handle may be retained in IndexedDB, but the PWA
   verifies permission before every session and never widens it to a parent
   directory.
2. `bridge`: a loopback-only local companion may expose the same vault contract
   for browsers without reliable directory-write support and for agent live
   status. It is not a remote Veylta backend and does not upload the vault.
3. Provider OAuth/native adapters are later tasks. They must preserve the same
   layout and receive their own security and license review.

The first PWA slice targets installable desktop Chromium and a locally
synchronized folder. Unsupported browsers receive an explicit capability
message and an export path; Veylta does not silently fall back to opaque browser
storage.

### Connected agent

Adopt `veylta-agent/v1`. The installable skill starts or discovers a helper
bound only to `127.0.0.1`, authenticates with a random session token kept
outside the vault, and long-polls a durable command journal. A command is one of
the closed allowlist operations, initially `scan_unprocessed` or
`analyze_document`. Document commands carry vault/profile/document selectors
and the expected source SHA-256.

Commands have queued, leased, completed, and failed lifecycle records. Leases
expire and requeue after agent interruption. Results are schema-validated,
written under a new immutable run, and linked to the exact input checksum.
The PWA shows queued/working/failed/completed states and requires explicit human
review before extracted facts become observations.

The agent does not receive arbitrary shell commands, URLs, cloud credentials,
or a general write path. Documents are untrusted data, never instructions. Any
action that changes accepted health history remains an explicit UI decision.

### Model data and cost boundary

Veylta does not require its own OpenAI API key for this connection model. The
user invokes the skill through their Codex environment and its applicable
subscription or credits. No application-owned token billing is added.

User-owned storage does not imply local-only model execution. Before an agent
reads a source, the UI must identify the selected documents and state that their
contents can be sent to the model service under the user's Codex account and
data-control terms. A local deterministic processor remains a separate,
no-egress option.

## Consequences

### Positive

- The family keeps an inspectable, portable primary record in storage it owns.
- Veylta has no central medical-data database or object bucket in the target
  product.
- Cloud-provider choice is outside the core domain and can change without a
  data migration.
- Agent execution is explicit, resumable, and attributable rather than an
  always-on server worker.
- The existing extraction/review/provenance contracts can migrate incrementally
  instead of being discarded.

### Negative

- Desktop Chromium is the first honest direct-directory target; Safari/iOS and
  provider-native access need later adapters.
- Cloud-sync conflict behavior varies by provider. Manifests therefore need
  immutable IDs and conflict detection rather than shared mutable database rows.
- Family sharing and revocation can no longer rely on one server transaction;
  vault encryption, key distribution, and shared-drive permissions require a
  separate design before real multi-person use.
- Codex processing can still create model-provider egress even though storage
  remains user-owned.

## Migration

SQLite/object storage remain the executable reference slice until equivalent
vault paths pass the same tests. Migration proceeds vertically: PWA shell and
capability detection, vault initialization/import, agent command bridge,
document analysis/result review, then observation history. No existing path is
removed before its vault-backed replacement is accepted.

## Rejected alternatives

- **Keep Veylta-hosted SQLite/object storage as the product:** makes Veylta the
  custodian and creates an avoidable central breach and operations boundary.
- **Store everything in OPFS/IndexedDB:** works offline but is origin-private,
  eviction/backup sensitive, and not the user's visible cloud-drive record.
- **Put cloud OAuth tokens in vault JSON:** syncs credentials alongside medical
  data and broadens every reader's authority.
- **Give an agent unrestricted filesystem or browser control:** breaks the
  narrow, reviewable command boundary and makes document prompt injection more
  dangerous.
- **Pretend directory access is cross-browser:** would make the PWA fail exactly
  where a user expects durable storage.
