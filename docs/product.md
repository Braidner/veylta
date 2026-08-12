# Product brief

## Purpose

Veylta is a self-managed family medical record centered on original
documents and longitudinal, confirmed health data. Its core job is to help a
person answer:

- What source documents do we have for this family member?
- Which values were actually reported, on what date, and by which laboratory?
- Which extracted values still need a human decision?
- How has a comparable confirmed indicator changed over time?
- What evidence supports a summary or recommendation?

It is a preparation and understanding tool, not a clinician, diagnostic system,
prescribing system, or complete EHR.

## Users and access model

| Role | Product responsibility |
| --- | --- |
| Family owner | Manages the family, configured storage, and access grants. |
| Adult member | Manages their linked personal profile and may receive a specific read grant. |
| Caregiver | Starts without a profile and may read only a profile explicitly shared by the owner. |
| Dependent profile | Represents a child or other dependent without its own login. |

Membership in a family is not blanket access to every patient profile. Every
medical-data request is authorized on the server against the active family,
profile, membership, and applicable consent grant. Access and material agent
actions produce audit events.

## Product principles

1. **Family-first.** Multiple adults and dependents coexist without implicit
   all-to-all access.
2. **Privacy-first.** Minimize egress and allow external OCR and LLM processing
   to be disabled completely.
3. **Source-first.** The immutable original is the primary evidence. Structured
   data never erases the raw source value.
4. **Human-in-the-loop.** Low-confidence or ambiguous facts cannot silently
   become confirmed observations.
5. **Explainable.** Values and later conclusions link to their document, page,
   source fragment, dates, and confidence.
6. **Longitudinal.** Comparisons use confirmed, compatible measurements and
   preserve laboratory-specific reference ranges.
7. **Portable.** Documents and structured data can ultimately be exported
   without binding the family to one vendor.
8. **No opaque health score.** A single unexplained score is out of scope.
9. **Progressive disclosure.** Start with an understandable summary, then allow
   inspection of details, evidence, and technical metadata.

## First vertical slice

The first slice proves one complete and safe path with synthetic data:

1. An authenticated demo user creates a family and a patient profile.
2. The user uploads a synthetic Russian-language PDF with a text layer, an
   image-only PDF scan, or a direct synthetic PNG/JPEG using the fixed local
   English OCR and synthetic fallback grammar.
3. The API validates and streams it to the default local `ObjectStorage/v1`,
   calculating SHA-256 without loading the entire file into memory. An optional
   S3-compatible adapter exists for synthetic operator testing only; it is not
   enabled in the demo default.
4. A repeat SHA-256 within the same family is reported as a possible duplicate;
   no document is automatically deleted.
5. A durable SQLite-backed background job reads a PDF text layer. Only when
   that layer is absent, it renders at most three bounded PDF pages and runs the
   checked-in local English OCR model; direct PNG/JPEG enters the same bounded
   local OCR path after image-header preflight. All paths then use the same
   deterministic parser for one explicitly supported synthetic report format.
6. Extracted facts retain raw text, value, unit, confidence, page, and fragment.
7. The parser marks uncertain or ambiguous facts as `needs_review`; all other
   extracted facts remain `extracted`. Both are untrusted and await an explicit
   human decision.
8. A user explicitly confirms, corrects, or rejects each fact. Confirmation or
   correction atomically creates an `Observation` and audit event without
   altering the raw extracted fact; rejection creates no observation (Task 6,
   delivered).
9. Indicator history displays the confirmed value, unit/reference, and an
   authorized link to its source (Task 7, delivered).
10. The two explicit synthetic analytes receive deterministic demonstration
    codes. A profile catalog and a compact chart compare only confirmed values
    with an identical code and exact source unit (Task 9, delivered).
11. The family owner can inspect a compact technical activity log. It lists
    only action, result, time, actor, and resource selector; it never exposes
    audit metadata, document content, filenames, source fragments, or medical
    values (Task 12, delivered).

The implemented synthetic record path reaches step 10, and the separate
owner-only activity log in step 11 is also delivered. A document is uploaded as
`queued`, then the worker exposes the real stages `security_check`,
`text_extraction`, `document_classification`, `structured_extraction`, and
`validation`. Successful synthetic extraction ends at `awaiting_review`; a
sanitized terminal failure is visible and may be retried. A fact decision is
always explicit: `confirm`, `correct`, or `reject`. The immutable decision,
optional confirmed observation, optional source-specific reference range, and
payload-free audit event commit together. Once every fact in the run has its
one final decision, that extraction run becomes `completed`. The profile-wide
history reads only immutable `confirmed` observations: it preserves corrected
source fields, distinguishes optional normalized fields, and re-authorizes the
original document when a user follows its source link. The Task 9 catalog adds
only deterministic, source-unit-compatible arithmetic: a display can state the
difference between the latest two numeric values, but never a reference-range
judgment, health conclusion, or recommendation. A nonnumeric value or another
unit is a separate source record, not an implicit conversion.

The repository, fixtures, tests, and supported deterministic parser are
synthetic-only. The local demo's upload boundary validates PDF/PNG/JPEG MIME/signature,
size, immutable storage, and authorization; it is not a reliable detector of
whether a user selected a real medical document. Real medical data remains out
of scope until the production controls in the threat model are implemented and
independently reviewed.

### Acceptance outcomes

- One documented command sequence starts web, API, worker, embedded SQLite, and
  persistent local document storage without a database container.
- Original bytes and SHA-256 remain stable across process restarts.
- Same-family duplicate detection is visible and does not create another blob.
- A different family cannot discover or retrieve the document, facts, or
  observations; inaccessible IDs return a non-disclosing response.
- Provenance reaches the document version, page number, and source fragment.
- Review is mandatory for uncertain data, and corrections preserve the raw
  extraction.
- Confirmed observations appear in a source-first profile history; the original
  document is authorized again when a user follows its source link.
- A failed confirmation produces no partial medical record.
- Job retry produces no duplicate facts or observations.
- All access and state-changing actions are audited without logging medical
  values.
- Worker completion, retry scheduling, and terminal failure are audit events
  committed with their corresponding SQLite state transition.
- Task 8 records the scoped lint, typecheck, unit, integration, end-to-end,
  migration, and license evidence using synthetic fixtures only.
- The compatible indicator catalog and chart preserve source links, exact units,
  and explicit insufficient/unavailable comparison states.

## Full MVP direction

Later slices may add a broader document classifier and
extraction schema, evidence-backed summaries
and safe recommendations, full role/consent management, export, and backup/restore. The local
demo now supports one-time adult and caregiver joins. An adult receives one
self-linked profile; a caregiver receives no profile until an owner explicitly
issues the one revocable `profile.read` grant. That grant is read-only and does
not grant upload, review, invitation, or audit capability; this is not a
production account, invitation, or consent-management system. Provider
boundaries must support local and external OCR/LLM implementations without
coupling the core domain to one vendor.

The planned complete processing state machine is:

`uploaded → security_check → text_extraction → document_classification → structured_extraction → validation → awaiting_review → persisting → trend_recalculation → summary_generation → completed|failed`

Only states backed by implemented behavior may be used. Task 5 implements the
queue through `awaiting_review`; Task 6 completes a run only after every fact
has one final review decision; Task 7 exposes those confirmed observations as a
source-first history; and Task 9 calculates a bounded compatible-value
difference without adding a processing state. The implementation does not fake
OCR, clinical trends, or summaries.

## Explicitly deferred

- Short-lived presigned URLs, S3 lifecycle/retention automation, and a live
  provider deployment runbook. The optional S3 adapter is not a real-data
  readiness claim.
- Any cloud OCR provider.
- Any LLM extraction, analysis, explanation, nutrition, or training agent.
- Automated trend summaries, recommendations, and red-flag UI.
- Full role-management UX, FHIR R4 mapping/import/export, portable export,
  controlled account deletion, and backup/restore workflows.
- Broad laboratory integration, clinical diagnosis, prescriptions, treatment
  changes, clinic billing/scheduling, and native mobile apps.

These are not shortcuts around safety requirements. Before any real user upload,
the production security, operations, privacy, deletion, backup, and recovery
controls in the threat model must be implemented and independently reviewed.

## Product evidence rules

- Every fixture and demo document is clearly synthetic.
- No real medical file, value, identity, credential, or secret enters source
  control, test output, screenshots, telemetry, or public logs.
- Product copy distinguishes extracted facts, user-confirmed observations,
  interpretations, and recommendations.
- No compliance, clinical-safety, accuracy, or provider-privacy claim is made
  without specific evidence and an appropriate audit.
