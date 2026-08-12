# HTTP API contract

## Status and conventions

This document defines the target `v1` contract for the first vertical slice. It
does not claim that the endpoints exist before their implementation task lands.

- Base path: `/v1`
- JSON for structured requests/responses; `multipart/form-data` only for upload.
- Opaque identifiers; examples use placeholders, not real medical data.
- Path identifiers use the canonical lower-case UUIDv4 form; alternate textual
  forms fail request validation before domain or storage access.
- RFC 3339 timestamps and explicit medically distinct date fields.
- `Idempotency-Key` is required for upload and the retry command. Review and
  confirmation commands are introduced by Task 6.
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

## Local demo identity, family, and profile

### `POST /v1/demo/registrations`

Creates an opaque local demo identity, session, family, owner membership, and
first linked adult profile in one transaction. The route is available only when
`DEMO_REGISTRATION_ENABLED=true`; it is disabled by default and rejected unless
the API binds to a loopback host. The documented dev runner also binds the web
proxy to loopback. This is synthetic local-development onboarding, not a
production authentication or account-recovery mechanism.

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
  "contractVersion": "family-profile/v1",
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
    "createdAt": "2026-08-11T00:00:00Z"
  }
}
```

The response sets an opaque `HttpOnly; SameSite=Strict` session cookie. Only its
SHA-256 digest is persisted. The request accepts no email, password, user ID, or
session token.

### `GET /v1/session`

Resolves the cookie server-side and returns the current demo user plus active
families and owner-accessible profiles. It returns `401` for an absent, expired,
revoked, or disabled session and is always `Cache-Control: no-store`.

### `DELETE /v1/session`

Revokes the current session transactionally, records a payload-free audit event,
and expires the cookie. It requires the configured web `Origin`.

### `POST /v1/families/{familyId}/profiles`

Creates an adult or dependent profile within an authorized family.

```json
{
  "displayName": "Synthetic profile",
  "kind": "dependent"
}
```

Response `201` contains the `family-profile/v1` contract version and a profile
with `id`, `familyId`, display name, kind, and `createdAt`. Additional adult
profiles are not implicitly linked to the owner identity.

### `GET /v1/families/{familyId}/profiles`

Returns only profiles the actor may access. It is not an inventory of all
profiles merely because the actor is a family member. Task 3 intentionally
implements only the active owner capability. Adult/caregiver grants remain
default-deny until their explicit consent lifecycle is implemented.

## Document upload and status

### `POST /v1/families/{familyId}/profiles/{profileId}/documents`

Headers:

- `Idempotency-Key: <opaque client-generated value>`
- multipart part `file`; the first slice accepts only a bounded PDF whose magic
  bytes and validated type agree.

The idempotency key is 16–200 printable ASCII characters and only its SHA-256
digest is stored. The current PDF limit is 5 MiB. The request must contain
exactly one file part and no fields.

The server streams the body through size/signature checks, SHA-256 hashing, and
`ObjectStorage/v1`. A display filename is never used as a storage path.

Response `202`:

```json
{
  "contractVersion": "document/v2",
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

On a same-family matching checksum, `possible` is true and the document/profile
IDs may refer to the authorized match. The server does not create another blob
or delete either logical record automatically. A match in another family is
never exposed. The upload transaction also creates one idempotent deterministic
extraction job, so a newly accepted document reports `queued` rather than a
fictional completed result.

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
and real processing state. Its `document.status` remains `uploaded`; the nested
processing state is one of `queued`, `security_check`, `text_extraction`,
`document_classification`, `structured_extraction`, `validation`,
`awaiting_review`, or sanitized `failed`. `awaiting_review` includes fact and
needs-review counts. A failed state includes a safe category and retry
eligibility, never a raw parser/database exception.

Every successful metadata read records a payload-free audit event with actor,
tenant, document, correlation ID, and time.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/processing`

Returns a compact status response and records a payload-free access audit event:

```json
{
  "contractVersion": "document/v2",
  "documentId": "document_placeholder",
  "processing": {
    "state": "awaiting_review",
    "updatedAt": "2026-08-12T00:00:00.000Z",
    "factCount": 2,
    "needsReviewCount": 1
  }
}
```

`failed` contains only one of `document_unavailable`, `invalid_document`,
`unsupported_document`, `extraction_failed`, `validation_failed`, or
`attempts_exhausted`, plus `retryAllowed`. Neither processing status nor errors
contain document text, a filename, a storage key, parser diagnostics, or values.

The checked-in fixture deliberately contains an ambiguous-unit fact, so its
implemented successful terminal result is `awaiting_review`. `completed` stays
in the versioned response contract for a future safe path; the browser never
fabricates it.

### `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/processing/retry`

Requires the exact configured `Origin` and an `Idempotency-Key`. It accepts no
body and is available only for the authorized document's `dead_letter` job. The
server records an immutable retry request, resets that existing job to `queued`,
and returns `202` with the same `document/v2` processing response shape.
Replaying the same family/actor/key returns the original accepted retry; a key
used for another document returns `409 IDEMPOTENCY_CONFLICT`. The caller cannot
select a job kind, parser, storage key, OCR provider, LLM provider, or URL.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/content`

After fresh authorization, proxies the original PDF stream from local storage.
Uses `Content-Disposition: attachment`, `nosniff`, a sandbox policy, and
`private, no-store`. Range behavior is not implemented in Task 4. The response
never exposes the local path. Authorized access produces a payload-free audit
event.

## Extracted facts (Task 5)

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/facts`

Returns immutable facts from the latest `awaiting_review` or `completed`
extraction run. It records a payload-free access audit event. Task 5 emits only
`extracted` and `needs_review`; it does not make a review decision or create an
observation.

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
      "source": {
        "documentVersionId": "version_placeholder",
        "pageNumber": 1,
        "fragment": "SYNTHETIC SOURCE FRAGMENT"
      }
    }
  ]
}
```

The UI must display source and proposed fields distinctly. A low-confidence or
ambiguous fact cannot be silently confirmed. `POST` review decisions, corrections,
and `Observation` creation are deliberately deferred to Task 6.

## Observation history and provenance (Task 7)

### `GET /v1/families/{familyId}/profiles/{profileId}/observations`

Optional query: `canonicalCode=<code>`. The response contains confirmed items
only, ordered by sample/result/upload dates with missing-date semantics explicit.

Each item includes:

- canonical code and source name;
- source value/unit and optional normalized value/unit plus conversion version;
- source-specific reference range and laboratory flag;
- separate sample, result, and upload dates;
- specimen/laboratory when known;
- reviewer/time and extraction confidence;
- document version, page number, source fragment, and authorized source URL.

The first slice may render a history table. It does not claim longitudinal
comparability, trend analysis, or a meaningful graph from one point.

## Processing jobs

Jobs are internal and not accepted from arbitrary browser payloads. The worker
polls SQLite for the single known `document_extraction` kind and versioned
identifier-only payloads, claims a bounded lease, and persists an attempt with
one of the implemented stages. It reads the authorized version through
`ObjectStorage/v1`, bounds and verifies its bytes, extracts its PDF text layer,
and accepts only the versioned synthetic grammar. There is no OCR, LLM, provider
SDK, arbitrary URL, or worker HTTP command surface.

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
and (for failure) a sanitized error code. Review, confirmation/rejection, and
future agent/provider egress add their own events in later tasks. Event metadata
never includes filenames, file content, page text, source fragments, medical
values, credentials, or signed URLs. Worker stdout carries only a processing
outcome and safe error code; it does not carry identifiers, document text, or
stack traces.

## Deferred APIs

No first-slice endpoint is defined for production authentication/account
recovery, adult/caregiver consent management, S3 configuration, OCR, LLM
providers, summaries, recommendations, FHIR, exports, backups, or account
deletion. Those contracts follow their own product, threat-model, and license
review.
