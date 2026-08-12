# Graph Report - health  (2026-08-12)

## Corpus Check
- 102 files · ~92,301 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1236 nodes · 2034 edges · 80 communities (65 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1598eb72`
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
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]

## God Nodes (most connected - your core abstractions)
1. `ObjectStorageKey` - 29 edges
2. `Database` - 22 edges
3. `scripts` - 22 edges
4. `assertObjectStorageKey()` - 20 edges
5. `S3ObjectStorage` - 20 edges
6. `createDatabase()` - 18 edges
7. `migrateUp()` - 16 edges
8. `compilerOptions` - 16 edges
9. `createLocalObjectStorage()` - 14 edges
10. `buildApp()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `TestContext` --references--> `Database`  [EXTRACTED]
  apps/api/test/document-processing.integration.test.ts → apps/api/src/database/pool.ts
- `TestContext` --references--> `Database`  [EXTRACTED]
  apps/api/test/document-review.integration.test.ts → apps/api/src/database/pool.ts
- `TestContext` --references--> `Database`  [EXTRACTED]
  apps/api/test/observation-history.integration.test.ts → apps/api/src/database/pool.ts
- `stagingKey()` --calls--> `createObjectStorageKey()`  [EXTRACTED]
  apps/api/src/storage/object-storage.contract.ts → apps/api/src/storage/object-storage.ts
- `run()` --calls--> `loadConfig()`  [EXTRACTED]
  apps/api/src/database/migrations.ts → apps/api/src/config.ts

## Import Cycles
- None detected.

## Communities (80 total, 15 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.20
Nodes (15): buildApp(), databaseReadiness(), createDocumentService(), registerDocumentRoutes(), createFamilyService(), registerFamilyRoutes(), app, config (+7 more)

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
Cohesion: 0.06
Nodes (33): AgentRun, AuditEvent, Condition, MedicationStatement, AllergyIntolerance, Encounter, Confirmed medical record, Database invariants to test, DiagnosticReport, Document, DocumentBlob (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (25): dependencies, @aws-sdk/client-s3, fastify, @fastify/multipart, @napi-rs/canvas, pdfjs-dist, tesseract.js, @tesseract.js-data/eng (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (20): useExhaustiveDependencies, useHookAtTopLevel, files, includes, formatter, enabled, indentStyle, indentWidth (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (33): Audit behavior, Comparable indicator catalog (Task 9), Deferred APIs, `DELETE /v1/families/{familyId}/profiles/{profileId}/consent-grants/{grantId}`, `DELETE /v1/session`, Document upload and status, Error envelope, Extracted facts and review (Tasks 5–6) (+25 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (16): compilerOptions, allowJs, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module (+8 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (15): dependencies, next, react, react-dom, @veylta/contracts, license, name, private (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (20): Delivery rules, First-slice executable acceptance matrix, First vertical slice, Later MVP slices, Task 10 — Optional S3-compatible immutable storage, Task 11 — Local synthetic scanned-PDF OCR fallback, Task 12 — Owner-only payload-free audit log, Task 13 — Local one-time adult invitation (+12 more)

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
Cohesion: 0.08
Nodes (38): asClaim(), asJob(), assertDate(), assertFact(), assertIdentifier(), assertPage(), AuditSourceRow, AutomatedProcessingOutcome (+30 more)

### Community 15 - "Community 15"
Cohesion: 0.20
Nodes (9): allowed, exceptions, policy, projectRoot, rejected, report, result, reviewedExpressions (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (8): Color, Components, Content, Intent, Layout, Motion, Typography, Veylta Design System

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (16): ADR 0001: System boundaries and API framework, Consequences, Context, Decision, Negative, Positive, Rejected alternatives, Review triggers (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.20
Nodes (9): ADR 0002: Versioned document storage boundary, Consequences, Context, Decision, Deferred work, Negative, Positive, Rejected alternatives (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (64): assertContained(), assertExistingContainer(), assertExpectedMetadata(), assertPayloadIntegrity(), assertSafeDirectory(), isErrorCode(), isMissing(), LocalObjectStorage (+56 more)

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
Cohesion: 0.04
Nodes (27): ConfirmedCorrection, ConsentPanelState, DocumentInboxProps, DocumentProcessingPanelProps, DocumentReviewPanelProps, DocumentViewProps, DocumentViewState, FactListState (+19 more)

### Community 24 - "Community 24"
Cohesion: 0.04
Nodes (53): DemoInvitationAcceptRequest, DemoInvitationAcceptResponse, DemoRegistrationRequest, DemoRegistrationResponse, DocumentProcessingActive, DocumentProcessingAwaitingReview, DocumentProcessingCompleted, DocumentProcessingFailed (+45 more)

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (6): Apache-2.0 and dual-licensed tooling, Browser compatibility data, CI infrastructure, Exact permissive ISC reviews, Synthetic PDF fixture font notice, Third-party notices

### Community 29 - "Community 29"
Cohesion: 0.05
Nodes (24): BlobRow, DocumentContent, DocumentRow, DocumentServiceOptions, ExtractionRunForFactsRow, FactForReviewRow, FactRow, IndicatorCatalogRow (+16 more)

### Community 32 - "Community 32"
Cohesion: 0.15
Nodes (14): FamilyAuditLogQuery, auditLogQuerySchema, consentGrantInputSchema, ConsentGrantParams, consentGrantParamsSchema, FamilyParams, familyParamsSchema, FamilyRouteOptions (+6 more)

### Community 34 - "Community 34"
Cohesion: 0.07
Nodes (28): AUDIT_LOG_CONTRACT_VERSION, DOCUMENT_CONTRACT_VERSION, DOCUMENT_PROCESSING_FAILURE_CATEGORIES, DOCUMENT_PROCESSING_STATES, DocumentFactsResponse, DocumentProcessingResponse, DocumentProcessingRetryResponse, DocumentResponse (+20 more)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (29): boolean(), databasePath(), envFile, integer(), isLoopback(), loadConfig(), objectStorage(), ObjectStorageRuntimeConfig (+21 more)

### Community 36 - "Community 36"
Cohesion: 0.09
Nodes (21): DocumentService, IdempotencyConflictError, IndicatorSeriesQuery, InvalidPdfSignatureError, ObservationHistoryQuery, StagedDocument, UnsupportedDocumentTypeError, UploadTooLargeError (+13 more)

### Community 37 - "Community 37"
Cohesion: 0.32
Nodes (11): defaultDirectory, ensureMigrationTable(), migrateDown(), migrateUp(), run(), createDatabase(), withTestContext(), withTestContext() (+3 more)

### Community 38 - "Community 38"
Cohesion: 0.36
Nodes (3): bodyBytes(), InMemoryS3Client, s3Failure()

### Community 39 - "Community 39"
Cohesion: 0.12
Nodes (22): allowedFixtureIssues, assertPage(), boundedField(), ExtractedFactReviewStatus, ExtractedPageText, factField(), factFieldPrefixes, invalidOutput() (+14 more)

### Community 40 - "Community 40"
Cohesion: 0.16
Nodes (13): DocumentParameters, extractPdfTextLayer(), isTextItem(), normalizedPageText(), PDF_TEXT_EXTRACTION_METHOD, PDF_TEXT_EXTRACTION_VERSION, pdfSignature, PdfTextExtractionError (+5 more)

### Community 41 - "Community 41"
Cohesion: 0.40
Nodes (3): registerDemoFamily(), syntheticLabFixture, syntheticNames()

### Community 42 - "Community 42"
Cohesion: 0.14
Nodes (6): isSqliteConstraintError(), sqliteErrorCode(), DocumentFixture, ProcessingGraph, rejectsConstraint(), ReviewGraph

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (8): Accepted path, Explicitly not accepted or deferred, First-slice acceptance evidence, Fresh local verification, Implementation lineage, Reproduction boundary, Requirement-to-evidence map, Safety and MIT boundary verified by this slice

### Community 44 - "Community 44"
Cohesion: 0.06
Nodes (38): DatabaseClient, QueryResult, finalObjectKey(), stagingObjectKey(), advance(), DocumentExtractionJobCoordinator, DocumentExtractionProcessor, DocumentExtractionProcessorDependencies (+30 more)

### Community 45 - "Community 45"
Cohesion: 0.18
Nodes (5): findProfileContext(), firstProfile(), VeyltaApp(), DocumentPageProps, ProfilePageProps

### Community 47 - "Community 47"
Cohesion: 0.21
Nodes (16): asCount(), canonicalTimestamp(), factReviewOutcome(), factReviewResponse(), factReviewSummary(), nullableBoundedString(), nullableCanonicalTimestamp(), nullableStoredText() (+8 more)

### Community 48 - "Community 48"
Cohesion: 0.20
Nodes (9): Acceptance outcomes, Explicitly deferred, First vertical slice, Full MVP direction, Product brief, Product evidence rules, Product principles, Purpose (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.22
Nodes (9): Assets, First-slice security invariants, Production gate for real data, Scope and status, Security verification, Threat actors and failure modes, Threat model, Threats and required controls (+1 more)

### Community 50 - "Community 50"
Cohesion: 0.25
Nodes (10): cookieFrom(), documentUrl(), fixtureUrl, Identity, multipartFile(), PreparedFact, registerOwner(), review() (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.21
Nodes (8): createLocalObjectStorage(), cookieFrom(), Identity, multipartFile(), MultipartOptions, registerOwner(), replaceObjectOnFirstGet(), upload()

### Community 52 - "Community 52"
Cohesion: 0.29
Nodes (7): Intended architecture, License, Local development, Product principles, Project status, Safety and data policy, Veylta

### Community 53 - "Community 53"
Cohesion: 0.17
Nodes (7): AppDependencies, bindings(), constraintCodes, ConstraintKind, execute(), ReadinessProbe, TransactionClient

### Community 56 - "Community 56"
Cohesion: 0.24
Nodes (9): createDocumentExtractionProcessor(), cookieFrom(), fixtureUrl, Identity, multipartFile(), processOneDocument(), registerOwner(), TestContext (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.22
Nodes (9): DocumentView(), FamilyInvitationPanel(), formatBytes(), formatDate(), knownObservationDates(), ObservationHistoryRow(), observationSourceHref(), referenceRangeCopy() (+1 more)

### Community 58 - "Community 58"
Cohesion: 0.38
Nodes (4): openReview(), registerDemoFamily(), syntheticLabFixture, syntheticNames()

### Community 59 - "Community 59"
Cohesion: 0.20
Nodes (10): documentFactsPath(), documentPath(), documentProcessingPath(), DocumentReviewPanel(), indicatorsPath(), MissingProfileScreen(), observationHistoryPath(), profileConsentGrantsPath() (+2 more)

### Community 60 - "Community 60"
Cohesion: 0.40
Nodes (5): isPendingReview(), proposedValue(), ReviewFactCard(), reviewStatusDescription(), reviewStatusLabel()

### Community 65 - "Community 65"
Cohesion: 0.11
Nodes (16): createProcessingJobService(), InvalidProcessingOutputError, InvalidProcessingStageTransitionError, ProcessingPersistenceConflictError, StaleProcessingLeaseError, advanceToValidation(), after(), AuditEventRow (+8 more)

### Community 66 - "Community 66"
Cohesion: 0.23
Nodes (13): cookieFrom(), documentPath(), fixtureUrl, historyPath(), Identity, indicatorsPath(), multipartFile(), PreparedFact (+5 more)

### Community 67 - "Community 67"
Cohesion: 0.09
Nodes (16): AuditLogCursor, auditLogItem(), AuditLogRow, auditTimestamp(), consentGrant(), ConsentGrantRow, consentMember(), ConsentMemberRow (+8 more)

### Community 68 - "Community 68"
Cohesion: 0.33
Nodes (6): DocumentProcessingPanel(), factCountCopy(), isProcessingActive(), processingFailureCopy(), ProcessingPresentation, russianPlural()

### Community 69 - "Community 69"
Cohesion: 0.36
Nodes (6): confirmAndReject(), correctAndReject(), factCard(), registerDemoFamily(), syntheticLabFixture, syntheticNames()

### Community 71 - "Community 71"
Cohesion: 0.08
Nodes (24): createLocalSyntheticOcr(), englishData, LOCAL_SYNTHETIC_OCR_ENGINE, LOCAL_SYNTHETIC_OCR_LANGUAGE, LocalSyntheticOcr, LocalSyntheticOcrCapabilities, LocalSyntheticOcrError, LocalSyntheticOcrErrorCode (+16 more)

### Community 72 - "Community 72"
Cohesion: 0.19
Nodes (13): isMultipartLimitError(), isMultipartParseError(), sendDocumentError(), DomainValidationError, FamilyService, ResourceNotFoundError, SessionActor, canonicalUuidSchema (+5 more)

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (3): canonicalDocumentScope(), canonicalFactScope(), canonicalProfileScope()

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (3): cursorTimestamp(), decodeIndicatorSeriesCursor(), decodeObservationHistoryCursor()

### Community 75 - "Community 75"
Cohesion: 0.67
Nodes (3): parseStoredObject(), referenceRange(), stringArray()

## Knowledge Gaps
- **550 isolated node(s):** `name`, `version`, `private`, `license`, `type` (+545 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ObjectStorageKey` connect `Community 19` to `Community 51`, `Community 44`, `Community 29`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `ObjectStorage` connect `Community 19` to `Community 51`, `Community 35`, `Community 44`, `Community 29`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `createObjectStorageKey()` connect `Community 44` to `Community 56`, `Community 19`, `Community 29`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _550 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._