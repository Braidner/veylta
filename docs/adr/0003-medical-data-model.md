# ADR 0003: Extracted facts and confirmed observations

- Status: Accepted
- Date: 2026-08-11

## Context

Document parsing is fallible. A parser may misread a decimal separator, attach
the wrong unit, confuse a reference range with a result, or lack a specimen/date.
Saving parser output directly as a clinical observation would erase uncertainty
and make later corrections hard to explain.

## Decision

Keep three distinct layers:

1. Immutable document/page evidence.
2. `ExtractionRun` and immutable `ExtractedFact` records containing untrusted
   parser output, provenance, parser/schema version, confidence, and validation
   issues.
3. `Observation` records created only by an explicit confirmation/correction
   decision (or a future separately approved high-confidence policy).

For the first slice, all facts that are low-confidence or have ambiguous units
must enter `needs_review`; no automatic confirmation policy exists.

An observation stores the source name/value/unit exactly as reported separately
from optional canonical code and normalized value/unit. It also stores sample,
result, and upload dates separately; specimen and laboratory when known; the
document version, page, and source fragment; extraction confidence; review
status; reviewer; and review time. Reference ranges are source-specific child
records, not global truth.

Unit conversion is a separate, versioned and reproducible operation. It never
overwrites source data. Longitudinal analysis may compare only confirmed,
compatible observations and must retain differing laboratory references.

Confirmation uses one database transaction for the review decision,
observation/reference rows, and audit event. A uniqueness constraint from the
reviewed fact to its observation makes retries idempotent. Corrections create a
new review decision/output; raw extraction is not edited in place.

## Consequences

### Positive

- Users can distinguish what the document said, what the parser inferred, and
  what was confirmed.
- Provenance and confidence survive correction and normalization.
- Parser/model upgrades can be evaluated without rewriting medical history.
- Job retry cannot silently duplicate confirmed observations.

### Negative

- More records and explicit state transitions are required.
- The review UI must show raw and proposed values clearly.
- Re-extraction and correction history require careful queries rather than
  updating one row.

## Deferred work

- Canonical terminology catalog and FHIR R4 mappings.
- Broad unit conversion library and compatibility policy.
- Conditions, medications, allergies, encounters, summaries, recommendations,
  and agent-derived longitudinal interpretations.
- Any automatic high-confidence confirmation policy.

## Rejected alternatives

- **Parser writes `Observation` directly:** hides uncertainty and violates the
  human-review requirement.
- **Overwrite raw value with normalized value:** destroys evidence and makes
  conversion errors irreproducible.
- **One global reference range per indicator:** ignores document-, laboratory-,
  method-, age-, and sex-specific ranges.
- **Store only rendered JSON:** weakens constraints, provenance queries, and
  idempotency guarantees.
