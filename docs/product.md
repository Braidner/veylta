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

## Target product model

Veylta is an installable PWA backed by a household-owned server. SQLite is the
authoritative structured store and immutable source bytes live in a configured
local storage directory. The first visit creates one administrator account;
later visits require local sign-in. Administrators manage accounts, storage,
Codex connectivity, and access, while each profile remains an independently
authorized medical boundary.

Document analysis is explicit and visible. The local deterministic worker is
the default. An optional Codex adapter may process selected documents through a
locally installed `codex app-server`; the user's `codex login` session remains
owned by Codex. Veylta stores no model key or OAuth token, and the confirmation
screen must disclose which source can leave the home server. A person still
makes every final fact decision.

## Users and access model

| Role | Product responsibility |
| --- | --- |
| Administrator | Manages the home installation, accounts, storage, Codex connection, and every profile. |
| User | Opens their own linked profile and any profile explicitly shared with them. |
| Granted user | Reads only the named profile and capabilities explicitly granted to their account. |
| Dependent profile | Represents a child or other dependent without its own login. |

A profile URL is only a selector. Every medical-data request is authorized on
the server against the active account, system role, linked profile, and any
applicable explicit grant. Access and material agent actions produce audit
events.

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
12. The profile landing view lists a bounded source-first operational overview:
    recent immutable documents, sources awaiting explicit review, and explicitly
    confirmed values. Its assistant inbox is a deterministic projection of those
    same states; nutrition and movement only open the explicit care-plan flow.
    Its health signals count pending review, explicit source flags, recent
    sources, and confirmed values. It does not calculate a health score,
    clinical state, diagnosis, trend, or recommendation (Task 17, delivered).
13. An owner or self-linked adult can download a bounded local TAR snapshot of
    up to five latest synthetic source files and an immutable manifest. This is
    deliberately not a backup, restore format, or production portability claim
    (Task 18, delivered).
14. A local command can verify that downloaded snapshot's safe TAR structure,
    manifest, source signature, size, and SHA-256 before it is handled. It
    reports aggregate counts only and never extracts entries; it is not a proof
    of origin or clinical correctness (Task 19, delivered).
15. Once all facts in one run have an explicit final decision, the profile can
    open an immutable, evidence-backed summary of confirmed observations. It
    marks new evidence and missing context and contains only the operational
    next actions to prepare sources for a clinician or complete pending review;
    it never diagnoses, triages, assigns risk/red flags, or advises treatment
    (Task 20, delivered).
16. The profile can reopen any earlier immutable summary version through a
    newest-first version index. Each selection returns the exact saved evidence
    set; the product does not derive a difference, trend, or recommendation from
    versions (Task 21, delivered).
17. A user can explicitly compare two immutable summary source sets. The result
    contains only newly included or no-longer-included confirmed records with
    their sources; it never labels the difference as a health change, trend, or
    recommendation (Task 22, delivered).
18. An owner or self-linked adult can export every current synthetic source and
    confirmed observation for one profile into a separately versioned local TAR.
    The export fails rather than silently omitting data above its ten-source cap;
    it is not a backup or restore flow (Task 23, delivered).
19. A family owner can reversibly archive any non-last active profile. The
    profile and its direct source/document reads disappear from active access,
    and pending extraction is paused until that owner restores it. Archive
    retains the immutable evidence graph and does not claim account deletion,
    retention, backup, recovery, or production restore (Task 24, delivered).
20. An authorized profile owner keeps a household care plan split into
    analyses, clinicians, nutrition, activity, and reminders. User-authored
    actions are explicit decisions, not recommendations inferred from medical
    evidence. On a separate acknowledged action, Codex may select at most one
    bounded draft in each existing lane from the latest confirmed summary. The
    UI discloses ChatGPT egress before the call; no original bytes, filenames,
    fragments, credentials, or OAuth tokens are sent. Every draft binds its
    immutable summary, model/runtime/rule, optional source observation, and
    missing context, and remains unaccepted until a person decides (Tasks 33a
    and 33b, delivered).

The implemented synthetic record path reaches step 20, and the separate
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
The Task 20 summary is a separate immutable read model built only from
confirmed observations; it keeps evidence and missing context visible rather
than deriving a health conclusion.

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
- A profile reader can inspect the same bounded plan, while only an
  administrator/owner or self-linked user can create or change its actions.
- A person-authored plan item survives reload and is never labelled as a Codex
  or evidence-derived recommendation.
- A Codex proposal requires literal egress acknowledgement, refuses API-key
  authentication, is replay-safe for one exact summary/model/rule, exposes its
  immutable provenance, and remains only a proposal until a person accepts it.
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
- The profile overview is bounded, profile-authorized, source-first, and links
  only to already-authorized document detail paths; opening it neither creates
  a clinical summary nor changes a record.
- The health summary is a bounded, profile-authorized, versioned snapshot of
  confirmed observations. It distinguishes new evidence from carried-forward
  evidence, has no clinical interpretation, and re-authorizes each source link.
- The summary version index is a separately audited, profile-authorized read of
  immutable snapshot selectors. Opening an earlier version reuses the same
  source-first summary representation; the index and UI never compute a change
  or a health conclusion across versions.
- A non-last active profile can be archived only by its family owner. Archiving
  hides the profile and its sources immediately without deleting them; the
  owner-only archive view can restore the same profile and resume pending work.

## Full MVP direction

Later slices may add a broader document classifier and extraction schema,
clinically reviewed recommendations, full role/consent management,
production export, account deletion, and backup/restore. The local
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
OCR, clinical trends, or clinical summaries. Task 20 materializes a post-review
evidence snapshot without adding a clinical processing state; Task 21 only
indexes and reopens those immutable snapshots; Task 22 compares their source
membership without a processing or clinical state.

## Explicitly deferred

- Short-lived presigned URLs, S3 lifecycle/retention automation, and a live
  provider deployment runbook. The optional S3 adapter is not a real-data
  readiness claim.
- Any cloud OCR provider.
- Persistent autonomous chat agents, unsolicited medical recommendations, and
  any LLM extraction, diagnosis, explanation, nutrition, or training decision.
  The delivered assistant cards are deterministic navigation; the existing
  bounded Codex care-plan draft still requires a separate acknowledged request.
- Automated clinical trend summaries, clinical recommendations, and red-flag UI.
- Full role-management UX, FHIR R4 mapping/import/export, controlled account deletion,
  and production backup/restore workflows.
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
