# ADR 0008: Codex-backed document intelligence

## Status

Accepted for the synthetic home-server product.

This supersedes ADR 0004 only for semantic document classification/extraction;
ADR 0004's source integrity, human review, and medical-safety constraints remain.

## Context

The first extraction slice recognized one deterministic laboratory fixture.
That was useful for provenance and retry testing but made ordinary bounded
documents fail as unsupported. The product now needs multi-document intake,
automatic archive classification, and a clean path to additional AI providers.

## Decision

1. Byte validation, immutable storage, SHA-256, authorization, local PDF text
   transport, and bounded OCR remain deterministic infrastructure.
2. Semantic classification and structured fact extraction use the
   `DocumentIntelligenceProvider` port. Codex is the delivered provider; a later
   provider must return the same closed versioned contract.
3. The browser accepts up to twenty files per batch and explicitly names Codex
   egress before upload. Each file remains its own replay-safe upload/job.
4. Codex runs through the locally authenticated CLI with `--ephemeral`, a
   read-only empty working directory, no shell/browser/plugins/memory/apps, and
   a strict output schema. Veylta never reads or stores Codex credentials.
5. The prompt receives page number and page content only. Tenant/profile IDs,
   original filename, object key, and filesystem path are excluded.
6. Model output is untrusted. Classification must use a closed category set;
   every extracted fact must cite an exact contiguous source fragment. Invalid
   output fails closed and never creates facts or observations.
7. Non-laboratory documents may complete with zero facts and still retain an
   immutable classification/title. Extracted facts still require explicit
   human confirmation, correction, or rejection.

## Consequences

- More document types can enter one consistent archive without maintaining a
  parser per layout.
- Analysis creates model-provider egress under the household's Codex/ChatGPT
  account, even though originals remain on the home server.
- Classification is probabilistic and versioned by provider, model, runtime,
  and schema. It is not a medical conclusion.
- Batch submission does not weaken per-file limits, idempotency, provenance,
  tenant isolation, or review requirements.
