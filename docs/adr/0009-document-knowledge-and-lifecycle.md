# ADR 0009: Document knowledge and lifecycle

- Status: accepted
- Date: 2026-08-14

## Context

The first Codex document adapter deliberately extracted only quantitative
laboratory measurements. That boundary is too narrow for genetic studies,
imaging conclusions, procedures, and other sources whose explicit result is a
categorical or textual finding rather than a number with a unit.

People also need to find a source by what it says, download it under its
original display name, avoid accidental repeat uploads, and remove an obsolete
source from the active archive without breaking immutable provenance.

## Decision

One bounded Codex invocation returns a versioned document-intelligence object
with four independently validated sections:

1. a closed document classification and Russian archive title;
2. a short factual Russian summary;
3. a detailed factual Russian summary;
4. source-provenanced structured results plus the existing quantitative lab
   facts when the source contains them.

The sections are logical processing stages, not separate model calls. This
keeps latency and disclosure bounded and gives every derived field the same
provider/model/runtime provenance. Verbatim evidence may remain in the source
language, but generated titles, summaries, and result labels are Russian.

Structured results support measurements, genetic variants, findings,
procedures, medications, diagnoses stated by the source, and a bounded `other`
fallback. They are untrusted extraction output. They can be displayed and
searched immediately, but they do not become a confirmed observation or a
profile-level medical conclusion without an explicit compatible review path.

The immutable intelligence row stores a pre-normalized, bounded search
projection assembled from its title, summaries, and structured result fields.
The API normalizes a bounded query in Node.js and performs a tenant/profile
authorized substring match in SQLite. This avoids relying on SQLite's limited
Unicode case folding and avoids a separate search service for a home archive.

Within one family and profile, uploading bytes whose SHA-256 already belongs to
an active document returns that existing logical document. It does not create a
second document or processing job. Another profile may still need its own
logical record, while the family-scoped immutable blob remains physically
deduplicated. Another family never receives a checksum oracle.

Downloads serve the verified original bytes and a safely encoded
`Content-Disposition` derived from the stored display filename. The filename is
never used as a storage path.

Deletion is an authenticated, origin-checked, idempotent tombstone of the
logical document. Deleted sources disappear from active reads, search, profile
overview, download, and duplicate matching. Immutable processing, decision,
observation, and audit provenance is retained; the first implementation does
not claim cryptographic erasure or backup deletion.

## Consequences

- Genetic and other non-quantitative studies become useful document analytics
  without being forced into the numeric observation model.
- Search remains local, explainable, and adequate for the bounded home-server
  dataset.
- The interface must label extracted results as source-derived and keep source
  fragments available beside summaries.
- A later task may add explicit review and longitudinal views for categorical
  results; it must not silently reinterpret the immutable generic result JSON.
- Physical erasure needs a separate retention and backup policy before the UI
  may promise it.

## Rejected alternatives

- **Three sequential model calls:** increases latency, cost, and inconsistent
  provenance without improving the first bounded output contract.
- **Force every result into a numeric lab fact:** loses categorical evidence and
  invents units for documents that do not contain them.
- **SQLite `lower()` for Russian search:** does not provide the required Unicode
  case folding consistently.
- **Immediate cascading hard delete:** conflicts with immutable provenance and
  cannot honestly cover external backups in the current product boundary.
