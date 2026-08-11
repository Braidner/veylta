# Product brief

## Purpose

Family Health is a self-managed family medical record centered on original
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
| Adult member | Manages their own profile and explicitly shares it. |
| Caregiver | Uses only the profiles and capabilities explicitly granted. |
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
2. The user uploads a synthetic Russian-language PDF with a text layer.
3. The API validates and streams it to local `ObjectStorage/v1`, calculating
   SHA-256 without loading the entire file into memory.
4. A repeat SHA-256 within the same family is reported as a possible duplicate;
   no document is automatically deleted.
5. A durable background job runs a deterministic parser for one explicitly
   supported synthetic report format.
6. Extracted facts retain raw text, value, unit, confidence, page, and fragment.
7. At least one low-confidence or ambiguous fact requires an explicit review.
8. Confirmation or correction atomically creates an `Observation` and audit
   event without altering the raw extracted fact.
9. Indicator history displays the confirmed value, unit/reference, and an
   authorized link to its source.

### Acceptance outcomes

- One documented command sequence starts web, API, worker, PostgreSQL, and
  persistent local document storage.
- Original bytes and SHA-256 remain stable across process restarts.
- Same-family duplicate detection is visible and does not create another blob.
- A different family cannot discover or retrieve the document, facts, or
  observations; inaccessible IDs return a non-disclosing response.
- Provenance reaches the document version, page number, and source fragment.
- Review is mandatory for uncertain data, and corrections preserve the raw
  extraction.
- A failed confirmation produces no partial medical record.
- Job retry produces no duplicate facts or observations.
- All access and state-changing actions are audited without logging medical
  values.
- Lint, typecheck, unit, integration, end-to-end, migration, and license checks
  pass using synthetic fixtures only.

## Full MVP direction

Later slices may add S3-compatible storage, scanned-document OCR fallback, a
broader document classifier and extraction schema, indicator charts and
comparisons, evidence-backed summaries and safe recommendations, audit views,
export, and backup/restore. Provider boundaries must support local and external
OCR/LLM implementations without coupling the core domain to one vendor.

The complete processing state machine is:

`uploaded → security_check → text_extraction → document_classification → structured_extraction → validation → awaiting_review → persisting → trend_recalculation → summary_generation → completed|failed`

Only states backed by implemented behavior may be used. The first slice stops
at review/confirmation and indicator history; it must not fake OCR, trend, or
summary stages.

## Explicitly deferred

- S3-compatible storage adapter and short-lived presigned URLs.
- OCR for scanned PDF/JPEG/PNG and any cloud OCR provider.
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
