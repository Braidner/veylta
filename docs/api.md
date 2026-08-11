# HTTP API contract

## Status and conventions

This document defines the target `v1` contract for the first vertical slice. It
does not claim that the endpoints exist before their implementation task lands.

- Base path: `/v1`
- JSON for structured requests/responses; `multipart/form-data` only for upload.
- Opaque identifiers; examples use placeholders, not real medical data.
- RFC 3339 timestamps and explicit medically distinct date fields.
- `Idempotency-Key` is required for upload and review/confirmation commands.
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

The server streams the body through size/signature checks, SHA-256 hashing, and
`ObjectStorage/v1`. A display filename is never used as a storage path.

Response `202`:

```json
{
  "document": {
    "id": "document_placeholder",
    "profileId": "profile_placeholder",
    "status": "uploaded",
    "contentType": "application/pdf",
    "byteSize": 1234,
    "sha256": "sha256_placeholder",
    "duplicate": {
      "possible": false,
      "documentId": null
    },
    "processing": {
      "state": "queued"
    }
  }
}
```

On a same-family matching checksum, `possible` is true and `documentId` may
refer to the authorized match. The server does not create another blob or delete
either logical record automatically. A match in another family is never exposed.

Replaying the same key and equivalent request returns the original outcome.
Reusing it for different bytes returns `409`.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}`

Returns immutable version metadata, possible same-family duplicate information,
and real processing state. First-slice states cover implemented work only, for
example `uploaded`, `security_check`, `text_extraction`,
`structured_extraction`, `validation`, `awaiting_review`, `completed`, or
`failed`. The API must not report OCR/summary stages that did not run.

A failed state includes a sanitized category and whether a safe retry is
available, never a raw parser/database exception.

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/content`

After fresh authorization, proxies the original PDF stream from local storage.
Uses safe content headers and supports only bounded range behavior implemented by
the adapter. It never exposes the local path. Access produces an audit event.

## Review

### `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/facts`

Returns facts from the latest selected extraction run:

```json
{
  "schemaVersion": "lab-extraction/v1",
  "items": [
    {
      "id": "fact_placeholder",
      "factKey": "synthetic-analyte-a",
      "sourceName": "SYNTHETIC_ANALYTE_A",
      "sourceValue": "7.0",
      "sourceUnit": "synthetic-unit",
      "proposedCanonicalCode": null,
      "proposedNormalizedValue": null,
      "proposedNormalizedUnit": null,
      "referenceRange": {
        "sourceText": "synthetic reference"
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
ambiguous fact cannot be silently confirmed.

### `POST /v1/families/{familyId}/profiles/{profileId}/facts/{factId}/review-decisions`

Requires `Idempotency-Key`. `factVersion` provides optimistic concurrency.

Confirmation without correction:

```json
{
  "factVersion": 1,
  "decision": "confirm"
}
```

Correction explicitly supplies reviewed source-facing data while the immutable
extracted fact remains unchanged:

```json
{
  "factVersion": 1,
  "decision": "correct_and_confirm",
  "correction": {
    "sourceValue": "7.1",
    "sourceUnit": "synthetic-unit"
  }
}
```

Rejection uses `{ "factVersion": 1, "decision": "reject" }`.

For confirmation, the server validates profile/document ownership and current
state, then atomically persists the decision, observation/reference rows, and
audit event. Response `201` identifies the decision and observation. Replaying
the same command does not create another observation. A different command for
the same idempotency key or a stale fact version returns `409`.

## Observation history and provenance

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
entry in `apps/api` polls PostgreSQL for known job kinds and versioned identifier-
only payloads. User-visible retry, when added, is an authorized command against a
failed document and creates/requeues the stable job key; it cannot inject a job
kind, storage key, URL, or parser/provider configuration.

## Audit behavior

Create audit events for authentication-relevant changes, family/profile changes,
upload, source download, extraction transitions, review, confirmation/rejection,
and future agent/provider egress. Event metadata includes actor, family, action,
resource ID, result, correlation ID, and time—not filenames, file content, page
text, source fragments, medical values, credentials, or signed URLs.

## Deferred APIs

No first-slice endpoint is defined for production authentication/account
recovery, adult/caregiver consent management, S3 configuration, OCR, LLM
providers, summaries, recommendations, FHIR, exports, backups, or account
deletion. Those contracts follow their own product, threat-model, and license
review.
