# Graph Report - health  (2026-08-14)

## Corpus Check
- 156 files · ~145,507 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1781 nodes · 3115 edges · 107 communities (96 shown, 11 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f0f3a8fe`
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
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 107|Community 107]]

## God Nodes (most connected - your core abstractions)
1. `ObjectStorageKey` - 36 edges
2. `Database` - 33 edges
3. `createDatabase()` - 28 edges
4. `createLocalObjectStorage()` - 27 edges
5. `migrateUp()` - 26 edges
6. `Vertical slice plan` - 23 edges
7. `buildApp()` - 22 edges
8. `scripts` - 22 edges
9. `createFamilyService()` - 21 edges
10. `registerFamilyRoutes()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `createLocalAgentBridge()` --calls--> `now`  [INFERRED]
  skills/veylta-agent/scripts/bridge-lib.mjs → apps/api/src/processing/document-extraction-processor.test.ts
- `TestContext` --references--> `Database`  [EXTRACTED]
  apps/api/test/document-review.integration.test.ts → apps/api/src/database/pool.ts
- `TestContext` --references--> `Database`  [EXTRACTED]
  apps/api/test/profile-overview.integration.test.ts → apps/api/src/database/pool.ts
- `ObjectStorageContractHarness` --references--> `ObjectStorage`  [EXTRACTED]
  apps/api/src/storage/object-storage.contract.ts → apps/api/src/storage/object-storage.ts
- `StoredS3Metadata` --references--> `ObjectStorageKey`  [EXTRACTED]
  apps/api/src/storage/s3-object-storage.ts → apps/api/src/storage/object-storage.ts

## Import Cycles
- None detected.

## Communities (107 total, 11 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.21
Nodes (21): buildApp(), createDocumentService(), registerDocumentRoutes(), createFamilyService(), registerFamilyRoutes(), createLocalObjectStorage(), createTestApp(), createTestApp() (+13 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (40): devDependencies, @biomejs/biome, @playwright/test, tsx, @types/node, @types/react, @types/react-dom, typescript (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.22
Nodes (9): Dependency allowlist, Exceptions, License policy, Medical data and repository contents, Prohibited core inclusion, Project license, Provider and data boundary, Review workflow (+1 more)

### Community 3 - "Community 3"
Cohesion: 0.15
Nodes (13): Architecture, Authentication and tenant isolation, Decision summary, Deployment and readiness, Document storage boundary, Evolution boundaries, Idempotency and consistency, Medical data boundary (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (35): AgentRun, AppAccount, AuditEvent, Condition, MedicationStatement, AllergyIntolerance, Encounter, Confirmed medical record, Database invariants to test, DiagnosticReport, Document (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (26): dependencies, @aws-sdk/client-s3, fastify, @fastify/multipart, @napi-rs/canvas, pdfjs-dist, tesseract.js, @tesseract.js-data/eng (+18 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (20): useExhaustiveDependencies, useHookAtTopLevel, files, includes, formatter, enabled, indentStyle, indentWidth (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (18): `DELETE /v1/families/{familyId}/profiles/{profileId}/consent-grants/{grantId}`, `GET /v1/families/{familyId}/archived-profiles`, `GET /v1/families/{familyId}/audit-events`, `GET /v1/families/{familyId}/members`, `GET /v1/families/{familyId}/profiles`, `GET /v1/families/{familyId}/profiles/{profileId}/consent-grants`, `GET /v1/settings`, Home-server settings (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (16): compilerOptions, allowJs, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module (+8 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (16): dependencies, next, react, react-dom, @veylta/contracts, license, name, private (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (41): Delivery rules, First-slice executable acceptance matrix, First vertical slice, Home-server PWA transition, Later MVP slices, PWA and user-owned vault transition, Task 10 — Optional S3-compatible immutable storage, Task 11 — Local synthetic scanned-PDF OCR fallback (+33 more)

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
Cohesion: 0.20
Nodes (19): assertContained(), assertExistingContainer(), assertExpectedMetadata(), assertPayloadIntegrity(), assertSafeDirectory(), isErrorCode(), isMissing(), LocalObjectStorage (+11 more)

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
Cohesion: 0.03
Nodes (34): AccountAccessScreenProps, ArchivedProfilesState, carePlanLanes, CarePlanState, ConfirmedCorrection, ConsentPanelState, DocumentInboxProps, DocumentProcessingPanelProps (+26 more)

### Community 24 - "Community 24"
Cohesion: 0.02
Nodes (106): AdminSetupRequest, AdminSetupResponse, AppAccountRole, AppAccountUser, ArchivedProfileListResponse, ArchivedProfileSummary, CARE_PLAN_CATEGORIES, CARE_PLAN_ITEM_STATES (+98 more)

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (6): Apache-2.0 and dual-licensed tooling, Browser compatibility data, CI infrastructure, Exact permissive ISC reviews, Synthetic PDF fixture font notice, Third-party notices

### Community 27 - "Community 27"
Cohesion: 0.40
Nodes (3): PwaRegistration(), metadata, viewport

### Community 29 - "Community 29"
Cohesion: 0.04
Nodes (45): BlobRow, decimalDelta(), DocumentContent, DocumentRow, DocumentServiceOptions, EvidenceBundleContent, EvidenceBundleDocumentRow, EvidenceBundleProfileRow (+37 more)

### Community 32 - "Community 32"
Cohesion: 0.20
Nodes (11): documentFactsPath(), documentPath(), DocumentProcessingPanel(), documentProcessingPath(), factCountCopy(), isProcessingActive(), processingFailureCopy(), ProcessingPresentation (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (11): Audit behavior, Deferred APIs, Error envelope, `GET /v1/families/{familyId}/profiles/{profileId}/observations`, `GET /v1/families/{familyId}/profiles/{profileId}/overview`, HTTP API contract, Observation history and provenance (Task 7), Observation history and provenance (Task 7) (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.04
Nodes (50): ACCOUNT_CONTRACT_VERSION, AUDIT_LOG_CONTRACT_VERSION, CarePlanResponse, DOCUMENT_CONTRACT_VERSION, DOCUMENT_PROCESSING_FAILURE_CATEGORIES, DOCUMENT_PROCESSING_STATES, DocumentFactsResponse, DocumentProcessingResponse (+42 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (29): boolean(), databasePath(), envFile, integer(), isLoopback(), loadConfig(), objectStorage(), optionalBoolean() (+21 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (27): DocumentService, HealthSummaryComparisonQuery, HealthSummaryHistoryQuery, HealthSummaryQuery, IdempotencyConflictError, IndicatorSeriesQuery, InvalidDocumentSignatureError, ObservationHistoryQuery (+19 more)

### Community 37 - "Community 37"
Cohesion: 0.15
Nodes (17): createAccountService(), registerAccountRoutes(), defaultDirectory, ensureMigrationTable(), migrateDown(), migrateUp(), run(), createDatabase() (+9 more)

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (13): access(), boundedText(), carePlanItem(), CarePlanItemRow, CarePlanScope, categorySet, localDate(), missingContext() (+5 more)

### Community 39 - "Community 39"
Cohesion: 0.12
Nodes (22): allowedFixtureIssues, assertPage(), boundedField(), ExtractedFactReviewStatus, ExtractedPageText, factField(), factFieldPrefixes, invalidOutput() (+14 more)

### Community 40 - "Community 40"
Cohesion: 0.16
Nodes (13): DocumentParameters, extractPdfTextLayer(), isTextItem(), normalizedPageText(), PDF_TEXT_EXTRACTION_METHOD, PDF_TEXT_EXTRACTION_VERSION, pdfSignature, PdfTextExtractionError (+5 more)

### Community 41 - "Community 41"
Cohesion: 0.23
Nodes (12): confirmOneFact(), cookieFrom(), documentPath(), evidenceBundlePath(), fixtureUrl, Identity, multipartFile(), portableProfileExportPath() (+4 more)

### Community 42 - "Community 42"
Cohesion: 0.24
Nodes (13): cookieFrom(), decide(), documentPath(), fixtureUrl, Identity, multipartFile(), PreparedDocument, profilePath() (+5 more)

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (8): Accepted path, Explicitly not accepted or deferred, First-slice acceptance evidence, Fresh local verification, Implementation lineage, Reproduction boundary, Requirement-to-evidence map, Safety and MIT boundary verified by this slice

### Community 44 - "Community 44"
Cohesion: 0.07
Nodes (34): DatabaseClient, QueryResult, advance(), DocumentExtractionJobCoordinator, DocumentExtractionProcessor, DocumentExtractionProcessorDependencies, DocumentSourceRow, DocumentSourceUnavailableError (+26 more)

### Community 45 - "Community 45"
Cohesion: 0.15
Nodes (5): findProfileContext(), firstProfile(), VeyltaApp(), DocumentPageProps, ProfilePageProps

### Community 47 - "Community 47"
Cohesion: 0.22
Nodes (18): canonicalChecksum(), canonicalTimestamp(), evidenceBundleDocument(), evidenceBundleExtension(), evidenceBundleProfile(), factReviewOutcome(), factReviewResponse(), factReviewSummary() (+10 more)

### Community 48 - "Community 48"
Cohesion: 0.18
Nodes (10): Acceptance outcomes, Explicitly deferred, First vertical slice, Full MVP direction, Product brief, Product evidence rules, Product principles, Purpose (+2 more)

### Community 49 - "Community 49"
Cohesion: 0.22
Nodes (9): Assets, First-slice security invariants, Production gate for real data, Scope and status, Security verification, Threat actors and failure modes, Threat model, Threats and required controls (+1 more)

### Community 50 - "Community 50"
Cohesion: 0.11
Nodes (17): AppDependencies, createCarePlanService(), registerCarePlanRoutes(), bindings(), constraintCodes, ConstraintKind, databaseReadiness(), execute() (+9 more)

### Community 51 - "Community 51"
Cohesion: 0.13
Nodes (6): isSqliteConstraintError(), sqliteErrorCode(), DocumentFixture, ProcessingGraph, rejectsConstraint(), ReviewGraph

### Community 52 - "Community 52"
Cohesion: 0.25
Nodes (8): Current executable architecture, License, Local development, Product direction: a home health-care PWA, Product principles, Project status, Safety and data policy, Veylta

### Community 53 - "Community 53"
Cohesion: 0.13
Nodes (17): ObjectStorageRuntimeConfig, createObjectStorage(), ExpectedObjectMetadata, ObjectMetadata, ObjectRead, ObjectStorage, RecoveryDeletionRequest, createS3ObjectStorage() (+9 more)

### Community 54 - "Community 54"
Cohesion: 0.26
Nodes (5): Database, TestContext, TestContext, TestContext, TestContext

### Community 56 - "Community 56"
Cohesion: 0.27
Nodes (8): createDocumentExtractionProcessor(), cookieFrom(), fixtureUrl, Identity, multipartFile(), processOneDocument(), registerOwner(), upload()

### Community 57 - "Community 57"
Cohesion: 0.17
Nodes (12): documentKindLabel(), DocumentView(), downloadLabel(), FamilyInvitationPanel(), formatBytes(), formatDate(), HealthSummaryPanel(), knownObservationDates() (+4 more)

### Community 58 - "Community 58"
Cohesion: 0.33
Nodes (5): ADR 0007: Home-server PWA, local accounts, and Codex runtime, Consequences, Context, Decision, Rejected alternatives

### Community 59 - "Community 59"
Cohesion: 0.12
Nodes (17): carePlanPath(), DocumentReviewPanel(), evidenceBundlePath(), healthSummaryComparisonPath(), healthSummaryHistoryPath(), healthSummaryPath(), indicatorsPath(), MissingProfileScreen() (+9 more)

### Community 60 - "Community 60"
Cohesion: 0.40
Nodes (5): isPendingReview(), proposedValue(), ReviewFactCard(), reviewStatusDescription(), reviewStatusLabel()

### Community 65 - "Community 65"
Cohesion: 0.11
Nodes (16): createProcessingJobService(), InvalidProcessingOutputError, InvalidProcessingStageTransitionError, ProcessingPersistenceConflictError, StaleProcessingLeaseError, advanceToValidation(), after(), AuditEventRow (+8 more)

### Community 66 - "Community 66"
Cohesion: 0.26
Nodes (12): cookieFrom(), documentPath(), fixtureUrl, historyPath(), Identity, indicatorsPath(), multipartFile(), PreparedFact (+4 more)

### Community 67 - "Community 67"
Cohesion: 0.08
Nodes (17): ArchivedProfileRow, AuditLogCursor, auditLogItem(), AuditLogRow, auditTimestamp(), consentGrant(), ConsentGrantRow, consentMember() (+9 more)

### Community 69 - "Community 69"
Cohesion: 0.08
Nodes (28): createSyntheticLabImage(), SyntheticLabImageFormat, openSyntheticProfile(), openReview(), registerDemoFamily(), syntheticLabFixture, syntheticNames(), registerDemoFamily() (+20 more)

### Community 71 - "Community 71"
Cohesion: 0.06
Nodes (38): dimensionsFromHeader(), extractImageTextWithLocalSyntheticOcr(), hasExpectedSignature(), ImageOcrExtractionError, ImageOcrExtractionErrorCode, jpegDimensions(), jpegSignature, LOCAL_SYNTHETIC_IMAGE_OCR_METHOD (+30 more)

### Community 72 - "Community 72"
Cohesion: 0.33
Nodes (6): Document upload and status, `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}`, `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/content`, `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/processing`, `POST /v1/families/{familyId}/profiles/{profileId}/documents`, `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/processing/retry`

### Community 73 - "Community 73"
Cohesion: 0.27
Nodes (9): ObjectStorageKey, boundedString(), digestKey(), isNotFound(), isPreconditionFailed(), metadataFromHeaders(), providerErrorStatus(), publicMetadata() (+1 more)

### Community 74 - "Community 74"
Cohesion: 0.40
Nodes (5): `GET /v1/setup`, Home-server setup and identity, Legacy synthetic test identity, `POST /v1/session`, `POST /v1/setup`

### Community 75 - "Community 75"
Cohesion: 0.13
Nodes (22): CarePlanService, ItemParams, itemParamsSchema, localDateSchema, ProfileParams, profileParamsSchema, isMultipartLimitError(), isMultipartParseError() (+14 more)

### Community 76 - "Community 76"
Cohesion: 0.29
Nodes (9): cookieFrom(), fixtureUrl, Identity, multipartFile(), overviewPath(), profilePath(), registerOwner(), TestContext (+1 more)

### Community 77 - "Community 77"
Cohesion: 0.15
Nodes (14): FamilyAuditLogQuery, auditLogQuerySchema, consentGrantInputSchema, ConsentGrantParams, consentGrantParamsSchema, FamilyParams, familyParamsSchema, FamilyRouteOptions (+6 more)

### Community 78 - "Community 78"
Cohesion: 0.10
Nodes (19): ADR 0006: User-owned vault and explicitly connected agent, Connected agent, Consequences, Context, Decision, Migration, Model data and cost boundary, Negative (+11 more)

### Community 79 - "Community 79"
Cohesion: 0.10
Nodes (41): createSyntheticEvidenceBundle(), EvidenceBundleInput, EvidenceBundleSource, octal(), tarEntry(), tarHeader(), validate(), allZero() (+33 more)

### Community 80 - "Community 80"
Cohesion: 0.22
Nodes (11): asCount(), audit(), byteSize(), createHealthSummaryIfNeeded(), processingFailureCategory(), processingForDocument(), processingStatus(), profileOverviewDocument() (+3 more)

### Community 81 - "Community 81"
Cohesion: 0.25
Nodes (10): cookieFrom(), documentUrl(), fixtureUrl, Identity, multipartFile(), PreparedFact, registerOwner(), review() (+2 more)

### Community 82 - "Community 82"
Cohesion: 0.50
Nodes (4): Evidence-backed profile summary (Task 20), `GET /v1/families/{familyId}/profiles/{profileId}/health-summary`, `GET /v1/families/{familyId}/profiles/{profileId}/health-summary/compare`, `GET /v1/families/{familyId}/profiles/{profileId}/health-summary/versions`

### Community 83 - "Community 83"
Cohesion: 0.50
Nodes (4): `GET /v1/families/{familyId}/profiles/{profileId}/evidence-bundle`, `GET /v1/families/{familyId}/profiles/{profileId}/portable-export`, Local synthetic evidence snapshot (Task 18), Offline verification command (Task 19)

### Community 85 - "Community 85"
Cohesion: 0.50
Nodes (4): healthSummaryStringArray(), parseStoredObject(), referenceRange(), stringArray()

### Community 87 - "Community 87"
Cohesion: 0.08
Nodes (22): allowed, args, AgentBridgeError, assertPrivateVaultDirectory(), atomicReplaceJson(), canonicalPotentialPath(), createLocalAgentBridge(), createMutex() (+14 more)

### Community 88 - "Community 88"
Cohesion: 0.29
Nodes (5): Veylta agent protocol v1, Veylta Agent, Границы, Обработка команды, Подключение

### Community 89 - "Community 89"
Cohesion: 0.67
Nodes (3): VeyltaAgentCommandBase, VeyltaAnalyzeDocumentCommand, VeyltaScanUnprocessedCommand

### Community 90 - "Community 90"
Cohesion: 0.15
Nodes (9): AccountService, AccountServiceOptions, AuthenticatedAccountResult, dummyPasswordHash, InvalidCredentialsError, newPasswordSchema, passwordSchema, usernameSchema (+1 more)

### Community 91 - "Community 91"
Cohesion: 0.67
Nodes (3): Comparable indicator catalog (Task 9), `GET /v1/families/{familyId}/profiles/{profileId}/indicators`, `GET /v1/families/{familyId}/profiles/{profileId}/indicators/{canonicalCode}`

### Community 92 - "Community 92"
Cohesion: 0.67
Nodes (3): Extracted facts and review (Tasks 5–6), `GET /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/facts`, `POST /v1/families/{familyId}/profiles/{profileId}/documents/{documentId}/facts/{factId}/review`

### Community 93 - "Community 93"
Cohesion: 0.12
Nodes (12): finalObjectKey(), stagingObjectKey(), DocumentSource, sourceForClaim(), defineObjectStorageContract(), firstKey, ObjectStorageContractHarness, ObjectStorageContractHarnessFactory (+4 more)

### Community 96 - "Community 96"
Cohesion: 0.20
Nodes (8): ADR 0003: Extracted facts and confirmed observations, Consequences, Context, Decision, Deferred work, Negative, Positive, Rejected alternatives

### Community 97 - "Community 97"
Cohesion: 0.09
Nodes (24): assertMaxBytes(), assertRecoveryDeletionRequest(), FinalizeObjectResult, ObjectStorageAlreadyExistsError, ObjectStorageIntegrityError, ObjectStorageNotFoundError, ObjectStorageSecurityError, ObjectStorageSizeLimitError (+16 more)

### Community 98 - "Community 98"
Cohesion: 0.19
Nodes (9): CodexRuntimeProbe, CodexRuntimeProbeResult, CommandExecutor, CommandResult, createCodexRuntimeProbe(), execute, executeCodex(), runtimeVersion() (+1 more)

### Community 99 - "Community 99"
Cohesion: 0.15
Nodes (7): ProcessingNotAvailableError, DomainConflictError, ResourceNotFoundError, SessionActor, AccountRow, createHomeSettingsService(), HomeSettingsService

### Community 100 - "Community 100"
Cohesion: 0.36
Nodes (3): bodyBytes(), InMemoryS3Client, s3Failure()

### Community 102 - "Community 102"
Cohesion: 0.50
Nodes (4): `DELETE /v1/session`, Family and profile, `GET /v1/session`, `POST /v1/demo/registrations` (test-only)

### Community 104 - "Community 104"
Cohesion: 0.40
Nodes (5): API, Runtime responsibilities, SQLite, Web, Worker

### Community 105 - "Community 105"
Cohesion: 0.50
Nodes (4): `GET /v1/families/{familyId}/profiles/{profileId}/care-plan`, Household care plan (Task 33a), `PUT /v1/families/{familyId}/profiles/{profileId}/care-plan/items/{itemId}`, `PUT /v1/families/{familyId}/profiles/{profileId}/care-plan/items/{itemId}/state`

### Community 106 - "Community 106"
Cohesion: 0.67
Nodes (3): canonicalDocumentScope(), canonicalFactScope(), canonicalProfileScope()

### Community 107 - "Community 107"
Cohesion: 0.67
Nodes (3): cursorTimestamp(), decodeIndicatorSeriesCursor(), decodeObservationHistoryCursor()

## Knowledge Gaps
- **753 isolated node(s):** `name`, `version`, `private`, `license`, `type` (+748 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `now` connect `Community 44` to `Community 87`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `createLocalAgentBridge()` connect `Community 87` to `Community 44`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `ObjectStorageKey` connect `Community 73` to `Community 0`, `Community 97`, `Community 44`, `Community 29`, `Community 19`, `Community 53`, `Community 93`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _753 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._