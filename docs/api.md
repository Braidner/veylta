# HTTP API contract

## Status and conventions

This document defines the implemented `v1` surface for the first vertical slice,
including the `observation-history/v1` and `audit-log/v1` read boundaries.

- Base path: `/v1`
- JSON for structured requests/responses; `multipart/form-data` only for upload.
- Opaque identifiers; examples use placeholders, not real medical data.
- Family, profile, and document path identifiers use the canonical lower-case
  UUIDv4 form. Fact identifiers are opaque `fact_<40 lower-case hex>` values;
  alternate forms fail request validation before domain or storage access.
- RFC 3339 timestamps and explicit medically distinct date fields.
- `Idempotency-Key` is required for upload, retry, restart, and fact-review commands.
- Browser identity is resolved server-side. A caller-supplied user ID is never
  accepted as authentication.
- Cookie-authenticated mutations require an exact `Origin` match with the
  configured web origin.
- All family/profile resources are authorized on every request. An inaccessible
  or cross-family identifier returns `404`.
- Schemas are strict: unknown fields fail rather than being silently accepted.

## Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be accepted.",
    "requestId": "req_placeholder",
    "details": []
  }
}
```

Messages exposed to a browser do not reveal storage paths, SQL details, parser
stacks, other tenant resources, document text, or medical values.

Common status meanings:

- `400`: malformed request or invalid state transition;
- `401`: no valid authenticated identity;
- `403`: authenticated but a non-resource capability is unavailable;
- `404`: resource missing or not accessible in the authorized tenant scope;
- `409`: idempotency conflict, stale version, or incompatible review state;
- `413`: upload exceeds the streamed size limit;
- `415`: media type/signature is unsupported;
- `422`: schema-valid command fails domain validation;
- `202`: processing accepted and asynchronous;
- `503`: safely retryable dependency failure.

## Home-server setup and identity

### `GET /v1/setup`

Returns `account/v1` and `setupRequired`. It is always private/no-store. On an
empty database this is the only product bootstrap path; it never accepts an
actor identifier or secret.

```json
{
  "contractVersion": "account/v1",
  "setupRequired": true
}
```

### `POST /v1/setup`

Available exactly once. With the configured browser `Origin`, it atomically
creates the first `admin`, home workspace, owner membership, linked adult
profile, session, and payload-free audit records. Username is case-insensitive
and normalized to lower-case; password length is 12–128 characters and storage
uses a versioned salted scrypt hash. A concurrent or later call returns `409`.

```json
{
  "username": "home-admin",
  "displayName": "Домашний администратор",
  "password": "a long local password"
}
```

Response `201` sets the opaque `HttpOnly; SameSite=Strict` session cookie and
returns the `account/v1` user plus the created family/profile selectors. It
never returns a password or password hash.

### `POST /v1/session`

Signs into an existing active local account using username and password. It
requires the configured browser `Origin`, returns `account/v1`, and sets a new
opaque session cookie. Unknown user and wrong password share the same
`401 INVALID_CREDENTIALS` envelope.

### Legacy synthetic test identity

`POST /v1/demo/registrations` remains disabled by default and exists only to
create isolated synthetic fixtures in browser/integration tests. The normal
`pnpm dev` flow never enables it.

## Family and profile

### `POST /v1/demo/registrations` (test-only)

Creates an opaque local demo identity, session, family, owner membership, and
first linked adult profile in one transaction. The route is available only when
`DEMO_REGISTRATION_ENABLED=true`; it is disabled by default and rejected unless
the API and every configured `WEB_ORIGINS` browser origin are loopback-only.
The E2E runner meets that constraint explicitly. A LAN-accessible deployment
must leave demo registration disabled. This is synthetic local-development
onboarding, not a production authentication or account-recovery mechanism.

```json
{
  "displayName": "Synthetic owner",
  "familyName": "Synthetic demo family",
  "profileName": "Synthetic owner profile"
}
```

Response `201`:

```json
{
  "contractVersion": "family-profile/v2",
  "family": {
    "id": "family_placeholder",
    "displayName": "Synthetic demo family",
    "role": "owner",
    "createdAt": "2026-08-11T00:00:00Z"
  },
  "profile": {
    "id": "profile_placeholder",
    "familyId": "family_placeholder",
    "displayName": "Synthetic owner profile",
    "kind": "adult",
    "access": "owner",
    "createdAt": "2026-08-11T00:00:00Z"
  }
}
```

The response sets an opaque `HttpOnly; SameSite=Strict` session cookie. Only its
SHA-256 digest is persisted. The request accepts no email, password, user ID, or
session token.

### `GET /v1/session`

Resolves the cookie server-side and returns the current local user plus active
families and profiles that actor may access. An administrator/owner receives
all active profiles in the home family, with their own linked profile sorted
first; a regular user receives their linked adult profile plus any currently
granted `profile.read` profile. Each returned profile names its server-determined
access as `owner`, `self`, or `granted_read`. Account-backed sessions
additionally return normalized `username` and system `role`; legacy test
sessions return `null` for those fields. A caregiver receives no profile list.
It returns `401` for an absent, expired, revoked, or disabled session and is
always `Cache-Control: no-store`.

### `DELETE /v1/session`

Revokes the current session transactionally, records a payload-free audit event,
and expires the cookie. It requires the configured web `Origin`.

## Home-server settings

Every settings response is private/no-store. These routes are intentionally
non-disclosing: a signed-in non-administrator receives `404`, with no account
names, filesystem paths, or Codex status.

### `GET /v1/settings`

Returns the administrator-only `home-settings/v2` projection:

```json
{
  "contractVersion": "home-settings/v2",
  "codex": {
    "installed": true,
    "authenticated": true,
    "authenticationMode": "chatgpt",
    "authenticationOwner": "codex_cli",
    "daemonRunning": false,
    "cliVersion": "codex-cli 0.x",
    "runtimeVersion": null,
    "preference": {
      "modelId": "gpt-5.6-sol",
      "reasoningEffort": "medium",
      "serviceTier": "standard"
    },
    "models": [
      {
        "id": "gpt-5.6-sol",
        "displayName": "GPT-5.6 Sol",
        "isDefault": true,
        "defaultReasoningEffort": "medium",
        "supportedReasoningEfforts": ["low", "medium", "high", "xhigh", "max", "ultra"],
        "supportsFastMode": true,
        "upgradeModelId": null
      }
    ],
    "usageLimits": [
      {
        "name": "Codex",
        "usedPercent": 35,
        "remainingPercent": 65,
        "windowDurationMinutes": 10080,
        "resetsAt": "2026-08-18T12:00:00.000Z"
      }
    ],
    "experimental": true
  },
  "storage": {
    "driver": "local",
    "rootPath": "/srv/veylta/objects",
    "state": "stable",
    "targetRootPath": null,
    "generation": 1,
    "relocationSupported": true,
    "lastFailureCode": null
  },
  "accounts": [
    {
      "id": "user_placeholder",
      "username": "home-admin",
      "displayName": "Домашний администратор",
      "role": "admin",
      "status": "active"
    }
  ]
}
```

The Codex projection contains capability/version data, the local app-server
model catalog, and its current rate-limit windows. Veylta never reads or returns
Codex OAuth tokens, API keys, account identifiers, or Codex-home contents.

### `POST /v1/settings/accounts`

Creates an `admin` or `user` plus a linked adult profile in the administrator's
home family. An `admin` receives owner membership and can manage every profile;
a `user` receives adult membership and can open only their linked profile or an
explicitly granted profile. It uses the same normalized username and scrypt
password boundary as setup, requires the configured `Origin`, and returns `409`
for duplicates.

```json
{
  "username": "family-user",
  "displayName": "Пользователь семьи",
  "role": "user",
  "password": "a different long local password"
}
```

Response `201` returns the safe account and profile selectors, never a password
or password hash.

### `POST /v1/settings/storage/relocate`

For local storage, copies every persisted document blob to a different absolute
directory, verifies bytes against SQLite size/content-type/SHA-256 records, and
then switches the authoritative root in the same serialized transaction. The
previous root remains as a recovery copy. Invalid/root/home paths return `422`;
active upload/relocation returns `409`; copy or verification failure returns
`503` without switching roots.

```json
{
  "rootPath": "/Volumes/Health/Veylta"
}
```

### `POST /v1/settings/codex/start`

Requests local `codex app-server daemon` startup. Codex owns authentication via
`codex login`; Veylta accepts and stores no API key. The safe status response and
payload-free audit report the result. This adapter is experimental and consumes
the household's Codex subscription limits.

### `PUT /v1/settings/codex/preferences`

Stores one server-wide execution profile used by new document analysis,
document dialogue, and care-plan proposal tasks. The administrator may choose
only a model and reasoning effort advertised by the local `model/list` result;
`fast` is accepted only when that model advertises the priority tier. The route
requires the configured `Origin`, records a payload-free audit event, returns
`422 CODEX_PREFERENCE_UNSUPPORTED` for a stale/unsupported choice, and returns
`503 CODEX_CATALOG_UNAVAILABLE` when the local catalog cannot be verified.

```json
{
  "modelId": "gpt-5.6-sol",
  "reasoningEffort": "high",
  "serviceTier": "fast"
}
```

### `POST /v1/families/{familyId}/profiles`

Creates an adult or dependent profile within an authorized family.

```json
{
  "displayName": "Synthetic profile",
  "kind": "dependent"
}
```

Response `201` contains the `family-profile/v3` contract version and a profile
with `id`, `familyId`, display name, kind, access, handle, and `createdAt`.
Additional adult profiles are not implicitly linked to the owner identity.

### `GET /v1/families/{familyId}/profiles`

Returns only profiles the actor may access. It is not an inventory of all
profiles merely because the actor is a family member. The owner receives all
active family profiles; an invited adult receives their linked profile plus
each currently granted `profile.read` profile, marked as `granted_read`; a
caregiver receives only those explicitly granted profiles. Both remain
default-deny for every other profile.

### `PUT /v1/families/{familyId}/profiles/{profileId}/handle`

Renames a profile's browser address (`/<handle>` on the web).

```json
{ "handle": "anna" }
```

Requires the owner or the profile's linked adult (`requireProfileWrite`). The
handle is lower-cased before validation; a value outside the allowed pattern or
on the reserved-word list returns `422`, one already taken by another profile
(any case) `409`, a profile the session may not write the usual non-disclosing
`404`. Setting the profile's current handle again is a no-op and writes no
audit row; otherwise the change writes a payload-free `profile.handle.changed`
event and the response carries the `family-profile/v3` contract version,
`profileId`, and the new `handle`.

### Profile archive and restore

`profile-archive/v1` is an owner-only, reversible local-demo access workflow.
It does not delete a profile, a source document, a blob, a raw extracted fact,
an observation, an audit event, or an extraction job.

### `POST /v1/families/{familyId}/profiles/{profileId}/archive`

Requires the active owner and the configured trusted `Origin`; it accepts no
body. The profile must be active and the family must retain at least one other
active profile. On success it sets the profile's archive timestamp, returns
`200`, and writes a payload-free `profile.archived` audit event with only the
`profile-archive/v1` marker:

```json
{
  "contractVersion": "profile-archive/v1",
  "profileId": "profile_placeholder",
  "archivedAt": "2026-08-13T00:00:00.000Z"
}
```

The archived profile is removed from `/v1/session` and active profile lists.
Every profile/document/history read for it uses the usual non-disclosing `404`.
The worker does not claim a queued job for it, and an in-flight completion is
rejected before it can persist extraction output. The original job remains
durable and can resume only after restore. Missing, already archived,
cross-family, adult-member, and caregiver selectors do not reveal state;
attempting to archive the last active profile returns `409`.

### `GET /v1/families/{familyId}/archived-profiles`

Owner-only `profile-archive/v1` list for the family. It returns each archived
profile's id, display name, kind, and `archivedAt`, newest first, and records
only a payload-free `family.archived_profiles.opened` audit marker. Other roles
and another family receive the same non-disclosing `404`.

### `POST /v1/families/{familyId}/profiles/{profileId}/restore`

Requires the active owner and trusted `Origin`; it accepts no body. It clears
only `archived_at`, returns `200` with `{ contractVersion, profileId,
restoredAt }`, and writes a payload-free `profile.restored` event. Existing
sources and jobs are neither copied nor modified; an eligible queued job may be
claimed again. A uniqueness conflict with a now-active linked profile returns
`409`; inaccessible or non-archived selectors remain non-disclosing.

### `POST /v1/families/{familyId}/invitations`

Local-demo only; requires the active owner session plus a trusted `Origin` and
the exact JSON body `{ "role": "adult_member" }` or `{ "role": "caregiver" }`.
It returns a `family-invitation/v2` one-time code exactly once. The server stores only its
SHA-256 hash, the invitation expires after 24 hours, and a database trigger
requires the issuer to be an active owner at issuance. The code is neither a family
credential nor a profile grant.

### `POST /v1/demo/invitations/accept`

Local-demo only; requires a trusted `Origin`. `{ code, displayName, profileName }`
accepts an `adult_member` invitation and atomically creates the linked adult
profile. `{ code, displayName }` accepts a `caregiver` invitation and creates no
profile at all. Both receive an opaque HttpOnly session; no invalid code reveals
whether it was unknown, expired, or already used. Neither role gains
family-wide access.

### `GET /v1/families/{familyId}/members`

Owner-only `profile-consent/v2` helper. Returns active invited adults and
caregivers in this family as `{ id, displayName, role }`; it does not expose
owners, sessions, or profile data. A member or another family gets the same
non-disclosing `404`.

### `GET /v1/families/{familyId}/profiles/{profileId}/consent-grants`

Owner-only `profile-consent/v2` projection of active grants for exactly one
profile. It returns only grant id, profile/family selectors, fixed capability,
creation time, and the receiving adult's minimal member projection. It does not
return revocation history or medical data; successful reads create a payload-free
audit event.

### `POST /v1/families/{familyId}/profiles/{profileId}/consent-grants`

Owner-only and requires the trusted `Origin`:

```json
{ "granteeUserId": "user_uuid", "capability": "profile.read" }
```

The receiving user must be an active invited `adult_member` or `caregiver` in
the same family. The response `201` is `profile-consent/v2` and returns the new
grant. There can be one active `profile.read` grant per profile/member; a duplicate returns `409`.
The server records a payload-free grant audit event. This capability permits only
profile/document/history/indicator reads; it does not permit upload, retry,
extraction review, invitations, or audit-log reads.

### `DELETE /v1/families/{familyId}/profiles/{profileId}/consent-grants/{grantId}`

Owner-only and requires the trusted `Origin`. It performs a one-way revoke and
returns `204`. Every later authorized read evaluates active grants again, so the
former recipient immediately receives the same non-disclosing `404` as for an
unknown profile or document. Revoke is payload-free audited and cannot be undone
by updating the immutable grant row.

### `GET /v1/families/{familyId}/audit-events`

Returns the owner-only `audit-log/v1` activity projection for one family. It is
always `Cache-Control: no-store`, uses newest-first keyset pagination, and
accepts only optional `limit` (`1`–`100`) and opaque `cursor` query parameters.
An active adult member or caregiver receives the same non-disclosing `404` as a
different family; this route does not grant profile or document access.

```json
{
  "contractVersion": "audit-log/v1",
  "items": [
    {
      "id": "audit_event_placeholder",
      "action": "profile.created",
      "result": "success",
      "occurredAt": "2026-08-12T12:00:00.000Z",
      "actor": { "id": "user_placeholder", "displayName": "Synthetic owner" },
      "resource": { "type": "PatientProfile", "id": "profile_placeholder" }
    }
  ],
  "nextCursor": null
}
```

The response intentionally omits audit metadata, correlation IDs, filenames,
document bytes/text, page fragments, and medical values. Every successful page
read records one new payload-free `family.audit_log.opened` event with only the
`audit-log/v1` contract version.

## Document upload and status

### `POST /v1/families/{familyId}/profiles/{profileId}/documents`

Headers:

- `Idempotency-Key: <opaque client-generated value>`
- multipart part `file`; the local slice accepts one bounded PDF, PNG, or JPEG
  whose magic bytes agree with the declared MIME type.

The idempotency key is 16–200 printable ASCII characters and only its SHA-256
digest is stored. The current document limit is 5 MiB. The request must contain
exactly one file part and no fields.

The server streams the body through size/signature checks, SHA-256 hashing, and
`ObjectStorage/v1`. A display filename is never used as a storage path.

Response `202`:

```json
{
  "contractVersion": "document/v5",
  "disposition": "created",
  "document": {
    "id": "document_placeholder",
    "familyId": "family_placeholder",
    "profileId": "profile_placeholder",
    "status": "uploaded",
    "originalFilename": "synthetic-result.pdf",
    "contentType": "application/pdf",
    "byteSize": 1234,
    "sha256": "sha256_placeholder",
    "uploadedAt": "2026-08-11T00:00:00Z",
    "duplicate": {
      "possible": false,
      "documentId": null,
      "profileId": null
    },
    "processing": {
      "state": "queued",
      "updatedAt": "2026-08-12T00:00:00.000Z"
    }
  }
}
```

The first accepted source returns `202` with `disposition: "created"`. An
identical active SHA-256 in the same family and profile returns `200` with
`disposition: "already_exists"` and the existing logical document; it creates
neither a document nor another processing job. An identical source for another
profile can create a separate logical record while reusing the family-scoped
blob. A match in another family is never exposed. A newly accepted document
reports `queued` rather than a fictional completed result.

Replaying the same key and equivalent request returns the original outcome and
records a separate payload-free replay audit event rather than another upload
event.

Reusing it for another profile or different bytes returns
`409 IDEMPOTENCY_CONFLICT`.

The local adapter first stages and validates the stream. The service then enters
an SQLite `BEGIN IMMEDIATE` transaction, rechecks idempotency/blob state,
atomically finalizes the deterministic tenant/checksum key, verifies storage,
and inserts the document/version/idempotency/audit rows and extraction job before
commit. A rollback can therefore leave an inaccessible final orphan but never a
document pointing to missing bytes; the same upload safely reuses that immutable
object on retry. Automated orphan retention/cleanup remains deferred.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}`

Returns immutable version metadata, possible same-family duplicate information,
full latest Codex intelligence (`intelligence`, nullable while queued), and real
processing state. Intelligence v2 contains a Russian `shortSummary`, Russian
`detailedSummary`, and bounded `structuredResults`. Every result has a closed
type/status, optional value/unit/code/laboratory/specimen/date, confidence, page,
and exact source fragment. These are source-derived proposals, not confirmed
Observations or medical recommendations. A result may be `above_range` only
when the source explicitly marks it high or its printed numeric value exceeds
the explicit range printed in the same source; the UI places those results
first and labels them `Выше диапазона`. No outside reference interval or medical
knowledge is used to derive that status. Its `document.status` remains
`uploaded`; the nested
processing state is one of `queued`, `security_check`, `text_extraction`,
`document_classification`, `structured_extraction`, `validation`,
`awaiting_review`, `completed`, or sanitized `failed`. `awaiting_review`
includes fact and needs-review counts; `completed` includes the final fact
count after every fact has one final decision. A failed state includes a safe
category and retry eligibility, never a raw parser/database exception.

`document/v8` adds `effectiveDate: { value, source }`: the person's correction if one is set
(`PUT …/documents/{documentId}/date`, below), else the document's own printed date, else the UTC
calendar day of `uploadedAt` — `source` names which as `"person" | "document" | "upload"`.

Every successful metadata read records a payload-free audit event with actor,
tenant, document, correlation ID, and time.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents?q={query}&limit={limit}`

Returns `document-search/v1` with at most 20 documents by default (maximum 50).
`q` is required and contains 2–120 visible characters. The server applies NFKC,
Russian-aware lowercasing, whitespace collapse, and an authorized local
substring match against the latest title, short/detailed summaries, and
structured result fields. The response is `private, no-store`; audit metadata
records only the contract version and never the raw query or medical matches.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/timeline?before={date}&limit={days}`

Returns `document-timeline/v1`: only reviewed documents — one still processing or carrying an
undecided fact stays in the queue instead (`isInDocumentQueue`) and never appears here. A page is
whole days: `limit` (`1`–`50`, default `50`) bounds how many of the most recent days strictly
before `before` (`YYYY-MM-DD`; omitted starts from the newest day) carry at least one entry, and
every entry of those days is returned, ordered by `effectiveDate` then `uploadedAt`, both
descending. A malformed `before` or an out-of-range `limit` is `422`.

```json
{
  "contractVersion": "document-timeline/v1",
  "entries": [
    {
      "id": "document_placeholder",
      "originalFilename": "synthetic-result.pdf",
      "contentType": "application/pdf",
      "uploadedAt": "2026-08-11T00:00:00.000Z",
      "effectiveDate": { "value": "2026-08-10", "source": "document" },
      "category": "laboratory",
      "title": "Общий анализ крови",
      "shortSummary": "...",
      "confirmedCount": 3,
      "outsideRangeCount": 1,
      "recordCount": 0
    }
  ],
  "nextBefore": "2026-08-01"
}
```

`confirmedCount` and `recordCount` are this document's confirmed observations and confirmed
clinician records; `outsideRangeCount` is the subset of those observations that the dossier's own
rule (`pointStatus`, `packages/contracts/src/observation-status.ts`) reads as outside their
printed range or flagged by the laboratory. `nextBefore` is the oldest returned day, to pass as
the next page's `before`, or `null` once nothing older remains. Access follows the same
owner/self-linked-adult/`profile.read`-grant boundary as every other profile resource; an
inaccessible or cross-family selector is the usual non-disclosing `404`. It is a safe `GET` — no
`Origin` or idempotency key — and returns `Cache-Control: no-store`. Each read records a
payload-free `profile.timeline.opened` audit event with only the contract version as metadata.

### `PUT /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/date`

The person's correction of a document's effective date.

```json
{ "documentDate": "2026-08-10" }
```

Requires the owner or the profile's linked adult (`requireProfileWrite`) and the configured
trusted `Origin`. `documentDate` is a calendar day, or `null` to drop the correction and fall back
to the document's own printed date or the upload day; a malformed day, or one further ahead than
tomorrow (UTC), returns `422`. A document the session may not write, or none, returns the usual
non-disclosing `404`. Setting the current value again is a no-op and writes no audit row;
otherwise the change writes a payload-free `document.date.corrected` event that never carries the
date itself, and the response carries the `document/v8` contract version, `documentId`, and the
resulting `effectiveDate: { value, source }`.

### `DELETE /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}`

Requires the configured trusted `Origin` and an `Idempotency-Key`. It returns a
`document-lifecycle/v1` receipt with `documentId` and `deletedAt`; an exact replay
returns the same receipt. The tombstone removes the source from active metadata,
content, processing, fact, agent, overview, search, export, and duplicate reads.
Immutable audit and already-confirmed provenance remain; this endpoint does not
claim physical storage or backup erasure.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/processing`

Returns a compact status response and records a payload-free access audit event:

```json
{
  "contractVersion": "document/v5",
  "documentId": "document_placeholder",
  "processing": {
    "state": "awaiting_review",
    "updatedAt": "2026-08-12T00:00:00.000Z",
    "factCount": 2,
    "needsReviewCount": 1
  },
  "activity": [
    {
      "code": "queued",
      "attempt": 0,
      "occurredAt": "2026-08-12T00:00:00.000Z"
    },
    {
      "code": "security_check_started",
      "attempt": 1,
      "occurredAt": "2026-08-12T00:00:01.000Z"
    },
    {
      "code": "result_saved",
      "attempt": 1,
      "occurredAt": "2026-08-12T00:00:08.000Z"
    }
  ]
}
```

`activity` is an ordered, append-only journal for the latest processing job.
Its closed codes describe only real persisted transitions: queued, source
security check, text extraction, document classification, Codex analysis,
result validation, saved result, scheduled retry, or terminal failure. It never
contains source text, extracted values, model output, prompts, chain-of-thought,
storage paths, or raw exceptions. The browser polls this read endpoint and does
not fabricate intermediate events.

`failed` contains only one of `document_unavailable`, `invalid_document`,
`agent_unavailable`, `agent_output_invalid`, `extraction_failed`, `validation_failed`, or
`attempts_exhausted`, plus `retryAllowed`. Neither processing status nor errors
contain document text, a filename, a storage key, parser diagnostics, or values.

The checked-in fixture deliberately contains an ambiguous-unit fact, so a
successful extraction first reaches `awaiting_review`. The service changes the
latest extraction run to `completed` only after every extracted fact has its
one final review decision; the browser never fabricates either state.

### `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/processing/retry`

Requires the exact configured `Origin` and an `Idempotency-Key`. It accepts no
body and is available only for the authorized document's `dead_letter` job. The
server records an immutable retry request, resets that existing job to `queued`,
and returns `202` with the same `document/v5` processing status shape. The next
processing read includes the appended requeue event in its journal.
Replaying the same family/actor/key returns the original accepted retry; a key
used for another document returns `409 IDEMPOTENCY_CONFLICT`. The caller cannot
select a job kind, parser, storage key, OCR provider, LLM provider, or URL.

### `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/processing/restart`

Requires the exact configured `Origin` and an `Idempotency-Key`, accepts no
body, and is available only when the latest job is terminal. It creates a fresh
`queued` Codex analysis job and returns `202`. The original bytes, earlier
extraction runs, review decisions, confirmed observations, and audit history
remain immutable. Reads and review actions use only the latest completed run;
an older fact selector cannot be reviewed after a restart. Replaying the same
family/actor/key returns the original accepted response and never creates a
second job.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/agent`

Returns the local `document-agent/v2` workspace for a document. Only the
administrator/owner or the self-linked adult who can write that profile may
open it; consent-only readers receive the same non-disclosing `404` as an
unknown document. An empty workspace returns `selectedConversationId: null`,
empty `conversations` and `messages` arrays, plus real document-processing jobs
in `runs`. Runs are explicitly `ephemeral: true` and never become chat history.
The optional `conversationId` query selects one authorized conversation;
otherwise the most recently updated conversation is selected. Every message
includes `role`, Russian `text`, `createdAt`, and either `provenance: null` for
the user or exact Codex/model/runtime provenance for the assistant. The response
is private and `no-store`.

### `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/agent/conversations`

Requires the session cookie, exact trusted `Origin`, and `Idempotency-Key`. The
closed body is `{ "title": "..." }`, trimmed and bounded to 80 characters. A
document may have at most 20 conversations. A new conversation returns the v2
workspace with `201`; an exact replay returns it with `200`; conflicting key
reuse returns `409`.

### `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/agent/conversations/{conversationId}/messages`

Requires the session cookie, exact trusted `Origin`, and `Idempotency-Key`.
The closed body is `{ "message": "..." }`, trimmed and bounded to 2,000
characters. A new exchange returns `201`; an exact replay returns the stored
workspace with `200` and no second Codex call. Reusing a key with different text
returns `409`. The conversation must belong to the same authorized document.

Veylta starts or resumes the selected conversation's local Codex CLI thread.
For the duration of that turn it supplies a random short-lived bearer capability
to the loopback-only `/mcp/document-agent` transport. MCP exposes only the
zero-argument read-only `get_document_context` tool; family/profile/document
selectors come from the server capability rather than model arguments. The tool
returns the current document metadata, processing state, and source-bound facts
after fresh write authorization. It cannot read the original bytes, access
SQLite/filesystem, confirm a fact, restart a job, or mutate Veylta state.

The user message and bounded context are sent through the locally authenticated
Codex CLI to the Codex model service. Veylta stores no Codex OAuth token or API
key. Dialogue and document content are never included in audit metadata or
server logs.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/content`

After fresh authorization, proxies the original PDF, PNG, or JPEG stream from the configured
`ObjectStorage/v1` adapter. The default is local storage; the optional
S3-compatible adapter does not change this HTTP surface or turn the path into a
provider bearer URL. Uses a safe UTF-8 `Content-Disposition: attachment` derived
from the stored original display filename, `nosniff`, a
sandbox policy, and `private, no-store`. Range behavior is not implemented in
Task 4. The response never exposes a local or provider path. Authorized access
produces a payload-free audit event.

## Extracted facts and review (Tasks 5–6)

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/facts`

Returns immutable facts from the latest `awaiting_review` or `completed`
extraction run. Every fact, including a high-confidence `extracted` fact,
requires an explicit final decision before the run can be `completed`. It
records a payload-free access audit event. `reviewStatus` is
derived at read time: an undecided raw fact remains `extracted` or
`needs_review`, a `confirm` or `correct` decision is exposed as `confirmed`,
and a `reject` decision is exposed as `rejected`. The stored raw extracted fact
is not changed by review.

```json
{
  "schemaVersion": "lab-extraction/v1",
  "extractionRunId": "run_placeholder",
  "extractorVersion": "synthetic-lab-parser/v1",
  "items": [
    {
      "id": "fact_placeholder",
      "factVersion": 1,
      "factKey": "synthetic-analyte-a",
      "sourceName": "SYNTHETIC_ANALYTE_A",
      "sourceValue": "7.0",
      "sourceUnit": "synthetic-unit",
      "proposedCanonicalCode": null,
      "proposedNormalizedValue": null,
      "proposedNormalizedUnit": null,
      "proposedSampledAt": null,
      "proposedResultedAt": null,
      "proposedSpecimenType": null,
      "proposedLaboratory": null,
      "referenceRange": {
        "sourceText": "synthetic reference",
        "sourceLow": null,
        "sourceHigh": null,
        "sourceUnit": null,
        "laboratoryOutOfRange": null
      },
      "confidence": 0.6,
      "validationIssues": ["AMBIGUOUS_UNIT"],
      "reviewStatus": "needs_review",
      "review": null,
      "source": {
        "documentVersionId": "version_placeholder",
        "pageNumber": 1,
        "fragment": "SYNTHETIC SOURCE FRAGMENT"
      }
    }
  ]
}
```

`review` is `null` until the explicit decision is stored; afterwards it is the
immutable decision summary, including its outcome, deciding account, decision
time, optional observation identifier, and (for `correct`) the confirmed source
correction. The enclosing facts response retains the extraction run and source
version. The UI must display source and proposed fields distinctly. A
low-confidence or ambiguous fact cannot be silently confirmed.

A bulk UI action may include only `reviewStatus: "extracted"` facts with an
empty `validationIssues` array. Every `needs_review` fact remains an individual
decision. When document intelligence and the lab extraction describe the same
measurement, the client pairs them only after exact page/fragment, source value,
and unit provenance match. The provider may then normalize a differing generic
result key to the fact key; a shared key never overrides conflicting provenance.
The client must not render two decision contexts for
one source measurement.

The document workspace may select one fact at a time and place its source page
and exact fragment beside the actions. It must disclose missing laboratory,
sample-date, and canonical-code fields as missing rather than manufacture them.
For an exact existing canonical code it may request the authorized
`observation-history/v1` filter and show that source-first history. The full
history link must preserve that exact `canonicalCode`; pagination remains bound
to the same filter. A contextual
"ask Codex" action only opens the existing document conversation; it does not
change a fact or create a decision.

### `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/facts/{factId}/review`

Requires the exact configured `Origin` and an `Idempotency-Key` of 16–200
printable ASCII characters. The command is one of:

```json
{
  "factVersion": 1,
  "decision": "confirm"
}
```

```json
{
  "factVersion": 1,
  "decision": "correct",
  "correction": {
    "sourceName": "SYNTHETIC_ANALYTE_A",
    "sourceValue": "7.1",
    "sourceUnit": "synthetic-unit"
  }
}
```

```json
{
  "factVersion": 1,
  "decision": "reject"
}
```

`correction` is required only for `correct`; it is forbidden for `confirm` and
`reject`. Its name, value, and unit are required source strings, not a clinical
interpretation. The supplied `factVersion` must match the immutable fact.

The first accepted command returns `201`:

```json
{
  "contractVersion": "document/v5",
  "review": {
    "id": "review_placeholder",
    "factId": "fact_0123456789abcdef0123456789abcdef01234567",
    "factVersion": 1,
    "outcome": "confirmed",
    "decidedAt": "2026-08-12T00:00:00.000Z",
    "decidedBy": {
      "id": "user_placeholder",
      "displayName": "Synthetic owner"
    },
    "observationId": "observation_placeholder"
  }
}
```

`outcome` is `confirmed`, `corrected`, or `rejected`; `observationId` is `null`
for a rejection. `decidedBy` and `decidedAt` identify the immutable human
decision; the associated facts read also retains its extraction run and source
version, so clients can render a decision journal without rewriting the source.
The same family, actor, idempotency key, fact, and canonical command replay the
original response with `200`. A conflicting key reuse,
stale version, or a different command after the fact has its final decision
returns `409`; inaccessible resources return `404`.

The command is atomic: it appends one immutable `ReviewDecision`, an immutable
idempotency request, and a payload-free audit event. `confirm` and `correct`
also create one confirmed `Observation` and, when the proposed source has one,
an `ObservationReferenceRange`; `reject` creates no observation. A fact can
have only one final decision. Review never mutates the extracted fact, and the
latest extraction run becomes `completed` only when every fact has such a
decision.

## Observation history and provenance (Task 7)

## Source-first profile overview (Task 17)

### `GET /v1/families/{familyId}/profiles/{profileId}/overview`

Returns the authorized profile's compact operational landing projection. It is
a safe `GET`, requires neither `Origin` nor an idempotency key, and returns
`Cache-Control: no-store`. Owner, self-linked adult, and explicitly
`profile.read`-granted adult/caregiver access use the same server-side profile
boundary as documents and history. Inaccessible and cross-family selectors
produce the same non-disclosing `404`.

The response is deliberately bounded: `recentDocuments`,
`reviewQueue.documents`, and `recentObservations` contain at most three entries
each, newest first. `reviewQueue.pendingFactCount` counts raw facts without a
final decision; `needsAttentionFactCount` is the subset marked
`needs_review`. A review queue item contains no extracted medical value: the
client follows the authorized document path to inspect evidence and choose an
explicit decision.

`profile-overview/v3` adds a top-level `documentCount` — every active document of the profile,
unlike the three-entry-capped `recentDocuments` — and carries `effectiveDate` on each
`recentDocuments` entry the same way as `document/v8`.

```json
{
  "contractVersion": "profile-overview/v1",
  "profile": {
    "id": "profile_placeholder",
    "familyId": "family_placeholder",
    "displayName": "Synthetic profile",
    "kind": "adult",
    "access": "owner",
    "createdAt": "2026-08-12T00:00:00.000Z"
  },
  "recentDocuments": [
    {
      "id": "document_placeholder",
      "originalFilename": "synthetic.pdf",
      "contentType": "application/pdf",
      "uploadedAt": "2026-08-12T00:00:00.000Z",
      "processing": { "state": "awaiting_review", "updatedAt": "2026-08-12T00:01:00.000Z", "factCount": 2, "needsReviewCount": 1 }
    }
  ],
  "reviewQueue": {
    "documentCount": 1,
    "pendingFactCount": 2,
    "needsAttentionFactCount": 1,
    "documents": [
      {
        "id": "document_placeholder",
        "originalFilename": "synthetic.pdf",
        "contentType": "application/pdf",
        "uploadedAt": "2026-08-12T00:00:00.000Z",
        "pendingFactCount": 2,
        "needsAttentionFactCount": 1
      }
    ]
  },
  "recentObservations": []
}
```

It is not a diagnosis, medical summary, health score, risk state, trend, or
recommendation. Each successful read writes a payload-free
`profile.overview.opened` audit event against the profile with only
`profile-overview/v1` as metadata; it never records filenames, values, units,
fragments, source bytes, or cursor data.

## Household care plan (Task 33a)

### `GET /v1/families/{familyId}/profiles/{profileId}/care-plan`

Returns `home-care-plan/v1` under the normal profile authorization boundary.
Administrators, the family owner, and the self-linked adult receive
`canWrite: true`; an explicitly granted `profile.read` actor receives the same
plan with `canWrite: false`. Unknown, archived, cross-family, and ungranted
selectors share the same non-disclosing `404`. The response is private and
non-cacheable.

```json
{
  "contractVersion": "home-care-plan/v1",
  "profileId": "profile_placeholder",
  "canWrite": true,
  "evidence": {
    "sourceCount": 2,
    "pendingReviewCount": 1,
    "confirmedObservationCount": 3,
    "latestSummary": {
      "id": "summary_placeholder",
      "version": 2,
      "createdAt": "2026-08-12T00:00:00.000Z"
    }
  },
  "items": [
    {
      "id": "item_placeholder",
      "category": "reminder",
      "title": "Обсудить повторный анализ",
      "note": null,
      "scheduledFor": "2026-09-15",
      "state": "accepted",
      "origin": "user",
      "revision": 1,
      "provenance": null,
      "createdAt": "2026-08-12T00:00:00.000Z",
      "updatedAt": "2026-08-12T00:00:00.000Z"
    }
  ]
}
```

Categories are `laboratory`, `clinician`, `nutrition`, `activity`, and
`reminder`. A user-authored item is an explicit household decision and always
has `origin: "user"`, `state: "accepted"`, and `provenance: null`; it is never
presented as an evidence-derived recommendation. A Codex proposal has
`origin: "codex"`, begins `proposed`, and must retain its immutable health
summary selector, optional source observation, proposal run, model, runtime,
rule version, and disclosed `missingContext` until retained or dismissed.

Successful reads append `profile.care_plan.opened` with only the contract
version. Titles, notes, schedule, medical counts, and provenance never enter
audit metadata.

### `PUT /v1/families/{familyId}/profiles/{profileId}/care-plan/items/{itemId}`

Creates a person-authored item using a client-generated canonical UUID. The
cookie-authenticated mutation requires the exact trusted `Origin`. The body is:

```json
{
  "category": "reminder",
  "title": "Обсудить повторный анализ",
  "note": "Взять подтверждённый источник",
  "scheduledFor": "2026-09-15"
}
```

The same UUID and canonical content replay with `200`; first creation returns
`201`; reuse with different content returns `409`. Only a writer may call the
route. It returns `{ "contractVersion", "profileId", "item" }` and writes a
payload-free create or replay audit event.

### `PUT /v1/families/{familyId}/profiles/{profileId}/care-plan/items/{itemId}/state`

Changes one retained item with optimistic revision checking:

```json
{ "revision": 1, "state": "completed", "scheduledFor": "2026-09-15" }
```

Allowed target states are `accepted`, `completed`, and `dismissed`. A proposal
may be accepted or dismissed; an accepted item may be rescheduled, completed,
or dismissed. Content and provenance are immutable and rows cannot be deleted.
An exact retry after a successful update returns the current revision; a stale
or invalid transition returns `409`/`422`. State audit events contain no title,
note, schedule, or medical payload.

### `POST /v1/families/{familyId}/profiles/{profileId}/care-plan/proposals`

Explicitly sends only the latest confirmed health-summary projection to the
model service through the locally installed Codex CLI: summary version and
closed missing-context labels plus each selected source name/value/unit,
canonical code, sample/result dates, laboratory, and its positional index. It
never sends source PDF/image bytes, filenames, fragments, document/observation
IDs, passwords, API keys, or OAuth tokens.
The trusted-origin body is deliberately literal:

```json
{ "acknowledgement": "send_confirmed_summary_to_codex" }
```

Only a profile writer may run it. The production adapter requires `codex login
status` to report ChatGPT authentication, removes Platform API-key variables,
and invokes `codex exec --ephemeral` in an empty temporary directory with a
read-only sandbox, local tools/extensions disabled, and a closed schema that
can select at most one item in each of the five lanes.

First completion returns `201`; the same summary/model/rule returns the stored
run with `200`, `replayed: true`, and no second Codex invocation. Every item
remains `proposed`. Audit contains only action and `home-care-plan/v1`, never
medical values, prompt, output, model, or context. Runtime/subscription failure
returns sanitized `503 CODEX_UNAVAILABLE`; malformed output returns `503
OUTPUT_INVALID`.

## Evidence-backed profile summary (Task 20)

### `GET /v1/families/{familyId}/profiles/{profileId}/health-summary`

Returns the latest immutable `health-summary/v1` snapshot for an authorized
profile. An optional strict `?version=N` (`N` is a positive decimal version)
returns exactly that immutable version. The latest form may return:

```json
{ "contractVersion": "health-summary/v1", "summary": null }
```

when no extraction run has completed final review with at least one confirmed
observation. The safe `GET` requires neither `Origin` nor an idempotency key;
it returns `Cache-Control: private, no-store`. The normal owner/self/granted
`profile.read` boundary applies. Unknown, cross-family, and ungranted selectors
use the same non-disclosing `404`.

```json
{
  "contractVersion": "health-summary/v1",
  "summary": {
    "id": "summary_placeholder",
    "version": 2,
    "createdAt": "2026-08-12T00:00:00.000Z",
    "previous": {
      "id": "summary_previous",
      "version": 1,
      "createdAt": "2026-08-11T00:00:00.000Z"
    },
    "evidenceScope": { "includedCount": 2, "totalConfirmedObservationCount": 2 },
    "groups": [
      {
        "id": "synthetic_laboratory",
        "label": "Синтетические лабораторные источники",
        "evidence": [
          {
            "isNewSincePreviousSummary": true,
            "observation": {
              "id": "observation_placeholder",
              "canonicalCode": "synthetic-analyte-a",
              "source": {
                "name": "СИНТЕТИЧЕСКИЙ АНАЛИТ A",
                "value": "7.0",
                "unit": "synthetic-unit"
              },
              "normalized": {
                "value": null,
                "unit": null,
                "conversionVersion": null
              },
              "referenceRange": null,
              "dates": {
                "sampledAt": null,
                "resultedAt": null,
                "uploadedAt": "2026-08-12T00:00:00.000Z"
              },
              "timelineAt": "2026-08-12T00:00:00.000Z",
              "specimenType": null,
              "laboratory": null,
              "extractionConfidence": 1,
              "confirmed": {
                "at": "2026-08-12T00:00:00.000Z",
                "by": { "id": "user_placeholder", "displayName": "Synthetic owner" }
              },
              "sourceDocument": {
                "id": "document_placeholder",
                "versionId": "version_placeholder",
                "pageNumber": 1,
                "fragment": "Synthetic source fragment",
                "contentPath": "/v1/families/family_placeholder/documents/document_placeholder/content"
              }
            },
          }
        ]
      }
    ],
    "newEvidenceCount": 1,
    "carriedForwardEvidenceCount": 1,
    "missingData": ["result_date"],
    "recommendations": [
      {
        "code": "prepare_source_for_clinician"
      }
    ],
    "redFlagStatus": "not_evaluated"
  }
}
```

`missingData` is closed to `confirmed_observations`, `sample_date`,
`result_date`, `laboratory`, and `canonical_indicator`. The only possible
operational recommendations are `prepare_source_for_clinician` and
`complete_pending_review`. Neither field is clinical advice. The response
does not calculate or state a diagnosis, treatment, urgency, risk, red flag,
or trend. Every evidence item comes from an immutable confirmed observation;
the relative document path is only a selector and is authorized again by the
content endpoint. A successful read writes `profile.health_summary.opened` and
generation writes `profile.health_summary.generated`, each carrying only the
contract marker and no medical payload.

### `GET /v1/families/{familyId}/profiles/{profileId}/health-summary/versions`

Returns the newest page of immutable summary selectors under the same
owner/self/granted `profile.read` boundary. Optional `beforeVersion` is a
positive decimal version and returns only earlier versions; optional `limit` is
`1` through `50` (default `25`). A cursor-like `nextBeforeVersion` is either the
last returned version for the next page or `null`.

```json
{
  "contractVersion": "health-summary-history/v1",
  "versions": [
    {
      "id": "summary_placeholder",
      "version": 2,
      "createdAt": "2026-08-12T00:00:00.000Z",
      "includedEvidenceCount": 2,
      "totalConfirmedObservationCount": 2,
      "newEvidenceCount": 1,
      "carriedForwardEvidenceCount": 1
    }
  ],
  "nextBeforeVersion": 2
}
```

The index is `Cache-Control: private, no-store`; unknown, cross-family, and
ungranted profile selectors are the same non-disclosing `404`. It writes the
payload-free `profile.health_summary_history.opened` audit event with only the
`health-summary-history/v1` marker. Selecting a version calls the first endpoint
with `?version=N`: it returns the exact source snapshot, never a derived
comparison, trend, diagnosis, or recommendation.

### `GET /v1/families/{familyId}/profiles/{profileId}/health-summary/compare`

Requires exact positive decimal `fromVersion` and `toVersion`, with
`fromVersion < toVersion`. Both immutable snapshots must exist in the same
authorized profile. It returns `health-summary-comparison/v1`:

```json
{
  "contractVersion": "health-summary-comparison/v1",
  "base": { "id": "summary_v1", "version": 1, "createdAt": "2026-08-12T00:00:00.000Z" },
  "target": { "id": "summary_v2", "version": 2, "createdAt": "2026-08-13T00:00:00.000Z" },
  "newlyIncluded": ["source-first ObservationHistoryItem"],
  "noLongerIncluded": []
}
```

Each list item is the same source-first, re-authorized observation projection
used by profile history. The response is a set-membership delta only: it does
not compare values, calculate direction, or say that health changed. It is
`Cache-Control: private, no-store`; unknown, cross-family, and ungranted
selectors use the same non-disclosing `404`. A successful read writes the
payload-free `profile.health_summary_comparison.opened` event carrying only the
`health-summary-comparison/v1` marker.

## Local synthetic evidence snapshot (Task 18)

### `GET /v1/families/{familyId}/profiles/{profileId}/evidence-bundle`

Returns an attachment-only `application/x-tar` archive named
`veylta-synthetic-evidence.tar`. It is a safe `GET`, does not require `Origin`
or an idempotency key, and returns `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`, and a sandbox CSP.

This route deliberately uses the stricter owner/self profile boundary. A
read-only `profile.read` grant can open source history but cannot download a
portable artifact. Inaccessible and cross-family selectors produce the same
non-disclosing `404`.

The TAR contains `manifest.json` and no more than five newest immutable source
entries under generated `documents/{documentId}.{pdf|png|jpg}` paths. The
manifest is `synthetic-evidence-bundle/v1`, records each source's immutable
checksum and byte size, and replaces API source URLs with that archive path.
Only confirmed observations whose source is among those selected five are
included. The service verifies every bundled byte sequence against its expected
checksum/size/content type before writing the archive. It never exposes a
storage key or makes user filenames into archive paths.

It is intentionally a local synthetic snapshot, not a backup, restore format,
account export, or real-data portability claim. A successful request writes
`profile.evidence_bundle.exported` with only
`synthetic-evidence-bundle/v1` as payload-free audit metadata.

### `GET /v1/families/{familyId}/profiles/{profileId}/portable-export`

Returns attachment-only `application/x-tar` as `veylta-synthetic-profile.tar`.
It has the same owner/self-only boundary, `private, no-store`, `nosniff`, and
sandbox response headers as the bounded source snapshot; a `profile.read` grant
does not authorize it and inaccessible selectors remain non-disclosing `404`s.

The generated TAR is `synthetic-profile-export/v1`. It includes **every** current
immutable source document and every confirmed observation whose provenance points
to those sources, with generated archive paths and reverified content type, size,
and SHA-256. It cannot silently truncate: a profile with more than ten synthetic
sources receives a `409 CONFLICT` before archive bytes or an export audit are
created. A successful request writes the payload-free
`profile.portable_export.exported` event with only the contract marker.

This is a bounded local synthetic portability artifact, not a restore endpoint,
account-deletion workflow, backup, production export, or proof of archive origin.

### Offline verification command (Task 19)

Run `pnpm --filter @veylta/api verify:evidence-bundle <bundle.tar>` before
manually handling a downloaded local archive. The command is completely local:
it neither contacts the API nor extracts entries to disk. It accepts only the
exact USTAR entry shapes produced by Task 18 and the local profile export,
enforces archive/manifest/document
byte limits, checks generated document paths and content-type signatures, and
recomputes each source SHA-256. This proves structural consistency of the local
snapshot, not cryptographic origin, clinical correctness, or production export
validity. Successful output contains only the contract version and
source/observation counts; failures reveal no archive payload.

## Observation history and provenance (Task 7)

### `GET /v1/families/{familyId}/profiles/{profileId}/observations`

Returns a source-first, profile-wide page of immutable confirmed observations.
It requires the authenticated actor to have access to both the family and
profile. Inaccessible and cross-family paths return the same non-disclosing
`404` as other family resources. The route is a safe `GET` and therefore does
not require `Origin` or an idempotency key.

All query parameters are optional and strict; unknown parameters fail request
validation:

- `canonicalCode`: lower-case `^[a-z0-9][a-z0-9._-]{0,99}$`; only observations
  with that exact stored code are returned.
- `limit`: an ASCII decimal integer from `1` through `100`; the default is `50`.
- `cursor`: a 1–500 character URL-safe opaque cursor returned by the prior
  page. The server validates its canonical shape and binds it to the same
  `canonicalCode` filter, so it cannot be reused with a different filter.

Items are ordered newest first by `sampledAt`, then `resultedAt`, then
`uploadedAt`, with the observation ID as the stable tie-breaker. `timelineAt`
returns the exact date selected by that precedence. `nextCursor` is `null` on
the final page.

```json
{
  "contractVersion": "observation-history/v1",
  "items": [
    {
      "id": "observation_placeholder",
      "canonicalCode": null,
      "source": {
        "name": "SYNTHETIC_ANALYTE_A",
        "value": "7.0",
        "unit": "synthetic-unit"
      },
      "normalized": {
        "value": null,
        "unit": null,
        "conversionVersion": null
      },
      "referenceRange": {
        "sourceText": "synthetic reference",
        "sourceLow": null,
        "sourceHigh": null,
        "sourceUnit": null,
        "laboratoryOutOfRange": null,
        "normalizedLow": null,
        "normalizedHigh": null,
        "normalizedUnit": null,
        "conversionVersion": null
      },
      "dates": {
        "sampledAt": null,
        "resultedAt": null,
        "uploadedAt": "2026-08-12T00:00:00.000Z"
      },
      "timelineAt": "2026-08-12T00:00:00.000Z",
      "specimenType": null,
      "laboratory": null,
      "extractionConfidence": 0.6,
      "confirmed": {
        "at": "2026-08-12T00:01:00.000Z",
        "by": {
          "id": "user_placeholder",
          "displayName": "Synthetic owner"
        }
      },
      "sourceDocument": {
        "id": "document_placeholder",
        "versionId": "version_placeholder",
        "pageNumber": 1,
        "fragment": "SYNTHETIC SOURCE FRAGMENT",
        "contentPath": "/v1/families/family_placeholder/profiles/profile_placeholder/documents/document_placeholder/content"
      }
    }
  ],
  "nextCursor": null
}
```

An item represents the `Observation` created by a final `confirm` or `correct`
decision; a rejected fact has no observation and cannot appear. Correction
therefore exposes the confirmed source name/value/unit while the raw extracted
fact remains unchanged. `source` and optional `normalized` data are deliberately
separate. The optional `referenceRange` is document-specific; it is not a
universal range and its laboratory flag only reports the source document.

`sourceDocument.contentPath` is a relative convenience path, not a bearer URL.
Following it reaches the immutable-document content endpoint, which authorizes
the actor again and returns a safe attachment. The history response itself and
the source path do not expose a storage key or local path.

Each successful history read records a payload-free
`observation.history.opened` audit event against the profile with only the
`observation-history/v1` contract metadata. It never records values, units,
fragments, document text, filenames, or cursor data. The browser presents the
same data as a table and does not claim longitudinal comparability, trend
analysis, or a meaningful graph from one point.

## Comparable indicator catalog (Task 9)

The deterministic parser recognizes exactly two **synthetic demonstration**
codes: `synthetic-analyte-a` and `synthetic-analyte-b`. They are not a clinical
terminology, diagnosis, or broad code-mapping claim. Unknown extracted facts
remain unclassified and never appear in this catalog.

### `GET /v1/families/{familyId}/profiles/{profileId}/indicators`

Returns the authorized profile's known-code confirmed observations grouped by
canonical code and exact source unit. It is a safe, strict `GET`; it requires
no `Origin` or idempotency key. There are no query parameters. A code with two
units yields two unit groups rather than an implicit conversion.

```json
{
  "contractVersion": "indicator-series/v1",
  "items": [
    {
      "canonicalCode": "synthetic-analyte-a",
      "displayName": "Синтетический аналит A",
      "units": [
        {
          "unit": "synthetic-unit",
          "observationCount": 2,
          "latest": {
            "value": "7.5",
            "timelineAt": "2026-08-12T00:00:00.000Z"
          }
        }
      ]
    }
  ]
}
```

### `GET /v1/families/{familyId}/profiles/{profileId}/indicators/{canonicalCode}`

Returns one source-first, keyset-paginated series only when `canonicalCode` is
one of the known synthetic codes and the required exact `unit` query is present.
The item shape is the same immutable source/provenance item used by
`observation-history/v1`, ordered newest first.

- `unit`: required 1–100 character exact source unit; it is not normalized or
  converted.
- `limit`: optional ASCII integer `1` through `100`, default `100`.
- `cursor`: optional 1–500 character opaque URL-safe cursor bound to both the
  code and unit.

When at least two observations have finite decimal source values, `comparison`
contains their unsigned absolute arithmetic difference and direction. The
comparison is a data description only: it does not compare with a reference
range, assess health, or recommend an action. Any nonnumeric value produces an
explicit `unavailable` state; fewer than two values produce `insufficient_data`.

```json
{
  "contractVersion": "indicator-series/v1",
  "indicator": {
    "canonicalCode": "synthetic-analyte-a",
    "displayName": "Синтетический аналит A",
    "unit": "synthetic-unit"
  },
  "items": ["same source-first observation items as observation-history/v1"],
  "comparison": {
    "state": "available",
    "previous": {
      "id": "observation_placeholder",
      "value": "7.0",
      "timelineAt": "2026-08-11T00:00:00.000Z"
    },
    "delta": { "value": "0.5", "direction": "increased" }
  },
  "nextCursor": null
}
```

Unknown code and inaccessible profile paths have the same non-disclosing `404`.
Every successful catalog or series read records a payload-free profile audit
event (`indicator.catalog.opened` or `indicator.series.opened`) containing only
the `indicator-series/v1` contract version.

## Processing jobs

Jobs are internal and not accepted from arbitrary browser payloads. The worker
polls SQLite for the single known `document_extraction` kind and versioned
identifier-only payloads, claims a bounded lease, and persists an attempt with
one of the implemented stages. It reads the authorized version through
`ObjectStorage/v1`, bounds and verifies its bytes, and extracts page evidence
with PDF.js or bounded local OCR. It then calls `DocumentIntelligenceProvider`.
The delivered Codex adapter runs ephemeral/read-only with tools and user
customizations disabled, returns a closed `document-intelligence/v2` result,
and is post-validated against exact page fragments. The result contains Russian
short and detailed summaries plus bounded generic structured results; compatible
quantitative laboratory facts continue through explicit review. A document with
no quantitative laboratory facts still completes and is filed by category.
There is no arbitrary URL or worker HTTP command surface.

User-visible retry is the authorized endpoint above. It can requeue only the
stable failed job and cannot inject a job kind, storage key, URL, or
parser/provider configuration.

## Audit behavior

Create audit events for authentication-relevant changes, family/profile changes,
upload, source download, processing/fact reads, retry requests, and terminal
worker outcomes. The worker commits its successful fact graph or
retry/dead-letter transition with exactly one payload-free event in the same
SQLite transaction. It is attributed to the uploader, correlated as the bounded
`worker:<jobId>`, and contains only `contractVersion`, `automated`, `outcome`,
and (for failure) a sanitized error code. Fact review,
confirmation/correction/rejection, and Codex/provider egress have their
own events. Event metadata
never includes filenames, file content, page text, source fragments, medical
values, credentials, or signed URLs. Worker stdout carries only a processing
outcome and safe error code; it does not carry identifiers, document text, or
stack traces.

## Deferred APIs

No first-slice endpoint is defined for production authentication/account
recovery, caregiver invitations, broader adult/caregiver consent capabilities
beyond the delivered local `profile.read` grant, S3 configuration or presigned
URLs, cloud OCR, LLM providers, clinical summaries, clinical recommendations,
FHIR, production exports, backups, or account deletion. Those contracts
follow their own product, threat-model, and license review.
