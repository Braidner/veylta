# ADR 0004: Deterministic extraction and agent safety boundary

- Status: Accepted
- Date: 2026-08-11

## Context

Medical documents are untrusted input, and generative models can follow prompt
injection, invent values, overstate certainty, or provide unsafe medical advice.
The product eventually needs provider-independent extraction and explanation,
but the first slice can prove provenance/review without an LLM.

## Decision

The first slice uses a deterministic parser for one narrow, synthetic Russian
laboratory report format. The worker reads a PDF text layer first. Only a
missing text layer activates a local, bounded English Tesseract model over
rendered PDF pages; direct PNG/JPEG enters the same path after exact-signature
and bounded header-pixel checks. All output must satisfy the same strict,
versioned `lab-extraction/v1` grammar. This local OCR path has no provider URL
or network access. External OCR, LLM calls, diagnosis, longitudinal
interpretation, summaries, and recommendations are not part of this slice.

Future OCR and LLM capabilities use independent provider ports supporting local
and external implementations. External providers are disabled by default and
require explicit family-owner configuration plus a clear warning describing
which provider receives which data.

Before any future LLM call, deterministic policy validates authorization,
purpose, minimum necessary input, confirmed-data requirements, and document
security state. Document text is delimited as untrusted data and cannot alter
system/tool policy. Output must match a strict versioned schema. Deterministic
post-processing validates citations, units, dates, ranges, confidence, prohibited
medical actions, and rule-based urgent red flags before presentation.

Agent roles remain separate:

- extraction only extracts facts;
- longitudinal analysis uses only confirmed compatible observations and
  distinguishes fact from interpretation;
- explainer provides evidence-backed plain-language questions/escalation, not
  diagnosis, prescribing, or dose changes;
- nutrition/training coaches provide general, bounded suggestions and stop for
  contraindications requiring clinician clearance.

Every agent result must identify used data/dates, source documents/observations,
facts versus assumptions versus recommendations, confidence, missing data, red
flags, and a concise disclaimer. Each `AgentRun` records purpose, input/output
schema and prompt versions, provider/model, parameters, timing, cost when
applicable, result status, and evidence links. Secrets and medical payloads do
not enter general logs.

## Consequences

### Positive

- The first slice is reproducible, testable, offline, and has no medical-data
  egress.
- Provider choice does not leak into core medical/domain contracts.
- Deterministic policy can block unsafe behavior even when a model is wrong or
  compromised by document text.
- Agent history remains inspectable and attributable.

### Negative

- A narrow parser supports only an explicitly documented fixture format.
- External OCR/LLM functionality arrives later and requires separate security,
  privacy, medical-safety, accuracy, cost, and license evaluation. Direct
  PNG/JPEG remains bounded to the same local English OCR and strict grammar.
- Strict evidence and review requirements can slow processing.

## Rejected alternatives

- **LLM parser in the first slice:** unnecessary egress, non-determinism, cost,
  and prompt-injection surface before the storage/review path is proven.
- **Fake OCR/LLM stages:** creates misleading product state and untestable safety
  claims.
- **Model-only red flags:** urgent safety behavior must also be deterministic.
- **One general medical agent:** mixes extraction, analysis, and advice with
  incompatible permissions and validation rules.
- **Silent external fallback:** violates owner choice and privacy-first defaults.
