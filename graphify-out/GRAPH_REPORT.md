# Graph Report - health  (2026-08-12)

## Corpus Check
- 67 files · ~32,807 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 662 nodes · 927 edges · 42 communities (37 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `506b0990`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]

## God Nodes (most connected - your core abstractions)
1. `scripts` - 22 edges
2. `compilerOptions` - 16 edges
3. `Database` - 15 edges
4. `LocalObjectStorage` - 13 edges
5. `Architecture` - 13 edges
6. `ObjectStorageKey` - 12 edges
7. `assertObjectStorageKey()` - 12 edges
8. `scripts` - 11 edges
9. `loadConfig()` - 11 edges
10. `createDatabase()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `loadConfig()`  [EXTRACTED]
  apps/api/src/database/migrations.ts → apps/api/src/config.ts
- `StagedDocument` --references--> `StagedObjectMetadata`  [EXTRACTED]
  apps/api/src/documents/document-service.ts → apps/api/src/storage/object-storage.ts
- `finalObjectKey()` --calls--> `createObjectStorageKey()`  [EXTRACTED]
  apps/api/src/documents/document-service.ts → apps/api/src/storage/object-storage.ts
- `stagingObjectKey()` --calls--> `createObjectStorageKey()`  [EXTRACTED]
  apps/api/src/documents/document-service.ts → apps/api/src/storage/object-storage.ts
- `sendDocumentError()` --calls--> `errorEnvelope()`  [EXTRACTED]
  apps/api/src/documents/routes.ts → apps/api/src/http/route-helpers.ts

## Import Cycles
- None detected.

## Communities (42 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (40): AppDependencies, buildApp(), defaultDirectory, ensureMigrationTable(), migrateDown(), migrateUp(), run(), bindings() (+32 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (40): devDependencies, @biomejs/biome, @playwright/test, tsx, @types/node, @types/react, @types/react-dom, typescript (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.22
Nodes (9): Dependency allowlist, Exceptions, License policy, Medical data and repository contents, Prohibited core inclusion, Project license, Provider and data boundary, Review workflow (+1 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (25): ADR 0003: Extracted facts and confirmed observations, Consequences, Context, Decision, Deferred work, Negative, Positive, Rejected alternatives (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (29): AgentRun, AuditEvent, Condition, MedicationStatement, AllergyIntolerance, Encounter, Confirmed medical record, ConsentGrant, Database invariants to test, DiagnosticReport, Document (+21 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (20): dependencies, @family-health/contracts, fastify, @fastify/multipart, license, name, private, scripts (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (20): useExhaustiveDependencies, useHookAtTopLevel, files, includes, formatter, enabled, indentStyle, indentWidth (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (21): Audit behavior, Deferred APIs, `DELETE /v1/session`, Document upload and status, Error envelope, `GET /v1/families/{familyId}/profiles`, `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}`, `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/content` (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (16): compilerOptions, allowJs, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module (+8 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (15): dependencies, @family-health/contracts, next, react, react-dom, license, name, private (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (9): First vertical slice, Task 1 — Product, architecture, safety, and license foundation, Task 2 — Runnable TypeScript foundation, Task 3 — Tenant-scoped family profile, Task 4 — Immutable local document upload, Task 5 — Idempotent deterministic extraction, Task 6 — Review and atomic observation confirmation, Task 7 — Indicator history and authorized source (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (12): default, exports, license, name, private, scripts, build, test (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, incremental, jsx, module, moduleResolution, noEmit, plugins (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (10): Accessibility & Inclusion, Anti-references, Brand Personality, Design Principles, Platform, Positioning, Product, Product Purpose (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.22
Nodes (9): Acceptance outcomes, Explicitly deferred, First vertical slice, Full MVP direction, Product brief, Product evidence rules, Product principles, Purpose (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.20
Nodes (9): allowed, exceptions, policy, projectRoot, rejected, report, result, reviewedExpressions (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (8): Color, Components, Content, Family Health Design System, Intent, Layout, Motion, Typography

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (16): ADR 0001: System boundaries and API framework, Consequences, Context, Decision, Negative, Positive, Rejected alternatives, Review triggers (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (8): ADR 0002: Versioned document storage boundary, Consequences, Context, Decision, Deferred work, Negative, Positive, Rejected alternatives

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (41): assertContained(), assertExistingContainer(), assertExpectedMetadata(), assertPayloadIntegrity(), assertSafeDirectory(), isErrorCode(), isMissing(), LocalObjectStorage (+33 more)

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (7): ADR 0004: Deterministic extraction and agent safety boundary, Consequences, Context, Decision, Negative, Positive, Rejected alternatives

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, types, extends, include

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (6): compilerOptions, declaration, outDir, rootDir, extends, include

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (22): ApiError, DocumentInboxProps, documentPath(), DocumentView(), DocumentViewProps, DocumentViewState, FamilyHealthApp(), FamilyHealthAppProps (+14 more)

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (19): DemoRegistrationRequest, DemoRegistrationResponse, DOCUMENT_CONTRACT_VERSION, DocumentResponse, DocumentStatus, DocumentSummary, FAMILY_PROFILE_CONTRACT_VERSION, FamilyRole (+11 more)

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (5): Apache-2.0 and dual-licensed tooling, Browser compatibility data, CI infrastructure, Exact permissive ISC reviews, Third-party notices

### Community 29 - "Community 29"
Cohesion: 0.10
Nodes (17): BlobRow, byteSize(), canonicalDocumentScope(), canonicalProfileScope(), DocumentContent, DocumentRow, DocumentServiceOptions, finalObjectKey() (+9 more)

### Community 32 - "Community 32"
Cohesion: 0.15
Nodes (5): DemoRegistrationResult, FamilyServiceOptions, MembershipRow, ProfileRow, Queryable

### Community 34 - "Community 34"
Cohesion: 0.17
Nodes (15): DomainConflictError, DomainValidationError, FamilyService, ResourceNotFoundError, SessionActor, FamilyParams, familyParamsSchema, FamilyRouteOptions (+7 more)

### Community 35 - "Community 35"
Cohesion: 0.14
Nodes (13): boolean(), databasePath(), envFile, integer(), isLoopback(), loadConfig(), origin(), projectRoot (+5 more)

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (15): DocumentService, IdempotencyConflictError, InvalidPdfSignatureError, UnsupportedDocumentTypeError, DocumentParams, documentParamsSchema, DocumentRouteOptions, InvalidIdempotencyKeyError (+7 more)

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (9): Assets, First-slice security invariants, Production gate for real data, Scope and status, Security verification, Threat actors and failure modes, Threat model, Threats and required controls (+1 more)

### Community 38 - "Community 38"
Cohesion: 0.29
Nodes (7): Family Health, Intended architecture, License, Local development, Product principles, Project status, Safety and data policy

### Community 40 - "Community 40"
Cohesion: 0.40
Nodes (4): Delivery rules, First-slice executable acceptance matrix, Later MVP slices, Vertical slice plan

## Knowledge Gaps
- **347 isolated node(s):** `name`, `version`, `private`, `license`, `type` (+342 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HTTP API contract` connect `Community 7` to `Community 39`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _347 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05924978687127025 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._