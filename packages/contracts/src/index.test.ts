import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_CONTRACT_VERSION,
  AUDIT_LOG_CONTRACT_VERSION,
  DOCUMENT_AGENT_CONTRACT_VERSION,
  DOCUMENT_AGENT_CONVERSATION_CREATE_COMMAND_SCHEMA,
  DOCUMENT_AGENT_MESSAGE_COMMAND_SCHEMA,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTRACT_VERSION,
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  DOCUMENT_LIFECYCLE_CONTRACT_VERSION,
  DOCUMENT_PROCESSING_EVENT_CODES,
  DOCUMENT_PROCESSING_FAILURE_CATEGORIES,
  DOCUMENT_PROCESSING_STATES,
  DOCUMENT_SEARCH_CONTRACT_VERSION,
  type DocumentAgentWorkspaceResponse,
  type DocumentFactsResponse,
  type DocumentIntelligenceResult,
  type DocumentProcessingResponse,
  type DocumentProcessingRetryResponse,
  type DocumentResponse,
  FACT_REVIEW_COMMAND_SCHEMA,
  FACT_REVIEW_DECISIONS,
  FACT_REVIEW_OUTCOMES,
  FAMILY_INVITATION_CONTRACT_VERSION,
  FAMILY_PROFILE_CONTRACT_VERSION,
  type FactReviewResponse,
  type FamilyAuditLogResponse,
  type FamilyInvitationCreateResponse,
  HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION,
  HEALTH_SUMMARY_CONTRACT_VERSION,
  HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION,
  HEALTH_SUMMARY_RECOMMENDATION_CODES,
  type HealthSummaryComparisonResponse,
  type HealthSummaryHistoryResponse,
  type HealthSummaryResponse,
  HOME_SETTINGS_CONTRACT_VERSION,
  HTTP_API_VERSION,
  INDICATOR_SERIES_CONTRACT_VERSION,
  type IndicatorSeriesResponse,
  LAB_EXTRACTION_RESULT_SCHEMA,
  LAB_EXTRACTION_SCHEMA_VERSION,
  LAB_FACT_VALIDATION_ISSUES,
  type LabExtractionResult,
  MAX_AUDIT_LOG_PAGE_SIZE,
  MAX_HEALTH_SUMMARY_HISTORY_PAGE_SIZE,
  MAX_INDICATOR_SERIES_PAGE_SIZE,
  MAX_OBSERVATION_HISTORY_PAGE_SIZE,
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS,
  MAX_SYNTHETIC_PDF_BYTES,
  MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS,
  OBJECT_STORAGE_CONTRACT_VERSION,
  OBSERVATION_HISTORY_CONTRACT_VERSION,
  type ObservationHistoryResponse,
  PROFILE_ARCHIVE_CONTRACT_VERSION,
  PROFILE_CONSENT_CONTRACT_VERSION,
  PROFILE_OVERVIEW_CONTRACT_VERSION,
  SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION,
  SYNTHETIC_INDICATOR_CATALOG,
  SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION,
  VEYLTA_AGENT_PROTOCOL_VERSION,
  VEYLTA_VAULT_CONTRACT_VERSION,
  type VeyltaAgentCommand,
  type VeyltaQueuedAgentCommandRecord,
  type VeyltaVaultDocumentManifest,
  type VeyltaVaultManifest,
} from "./index.js";

test("public contracts carry explicit versions", () => {
  assert.equal(HTTP_API_VERSION, "v1");
  assert.equal(ACCOUNT_CONTRACT_VERSION, "account/v1");
  assert.equal(HOME_SETTINGS_CONTRACT_VERSION, "home-settings/v5");
  assert.equal(DOCUMENT_CONTRACT_VERSION, "document/v7");
  assert.equal(DOCUMENT_INTELLIGENCE_CONTRACT_VERSION, "document-intelligence/v2");
  assert.equal(DOCUMENT_SEARCH_CONTRACT_VERSION, "document-search/v1");
  assert.equal(DOCUMENT_LIFECYCLE_CONTRACT_VERSION, "document-lifecycle/v1");
  assert.equal(DOCUMENT_AGENT_CONTRACT_VERSION, "document-agent/v2");
  assert.equal(FAMILY_PROFILE_CONTRACT_VERSION, "family-profile/v3");
  assert.equal(OBJECT_STORAGE_CONTRACT_VERSION, "object-storage/v1");
  assert.equal(OBSERVATION_HISTORY_CONTRACT_VERSION, "observation-history/v1");
  assert.equal(INDICATOR_SERIES_CONTRACT_VERSION, "indicator-series/v1");
  assert.equal(AUDIT_LOG_CONTRACT_VERSION, "audit-log/v1");
  assert.equal(PROFILE_CONSENT_CONTRACT_VERSION, "profile-consent/v2");
  assert.equal(PROFILE_OVERVIEW_CONTRACT_VERSION, "profile-overview/v2");
  assert.equal(HEALTH_SUMMARY_CONTRACT_VERSION, "health-summary/v1");
  assert.equal(HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION, "health-summary-history/v1");
  assert.equal(HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION, "health-summary-comparison/v1");
  assert.equal(SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION, "synthetic-evidence-bundle/v1");
  assert.equal(SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION, "synthetic-profile-export/v1");
  assert.equal(PROFILE_ARCHIVE_CONTRACT_VERSION, "profile-archive/v1");
  assert.equal(MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS, 5);
  assert.equal(MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS, 10);
  assert.equal(MAX_HEALTH_SUMMARY_HISTORY_PAGE_SIZE, 50);
  assert.equal(LAB_EXTRACTION_SCHEMA_VERSION, "lab-extraction/v1");
  assert.equal(MAX_SYNTHETIC_PDF_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_SYNTHETIC_DOCUMENT_BYTES, MAX_SYNTHETIC_PDF_BYTES);
});

test("document intelligence v2 carries bounded generic source results beside its summary", () => {
  const result = {
    contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
    provider: "codex",
    modelId: "gpt-5.4-mini",
    runtimeVersion: "codex-cli 0.147.0",
    category: "laboratory",
    title: "Синтетический лабораторный отчёт",
    documentDate: "2026-08-12",
    confidence: 0.96,
    shortSummary: "В документе указан один синтетический результат.",
    detailedSummary: "Документ содержит синтетическое измерение без медицинской интерпретации.",
    structuredResults: [
      {
        resultKey: "synthetic-glucose",
        type: "measurement",
        label: "Синтетическая глюкоза",
        value: "7.0",
        unit: "synthetic-unit",
        code: null,
        lab: "Синтетическая лаборатория",
        specimen: "Венозная кровь",
        date: "2026-08-12",
        status: "abnormal",
        confidence: 0.91,
        source: {
          pageNumber: 1,
          fragment: "Synthetic glucose: 7.0 synthetic-unit",
        },
      },
    ],
  } satisfies DocumentIntelligenceResult;

  assert.equal(result.structuredResults[0]?.type, "measurement");
  assert.equal(result.structuredResults[0]?.source.pageNumber, 1);
});

test("document agent workspace separates persistent conversations from ephemeral runs", () => {
  const response = {
    contractVersion: DOCUMENT_AGENT_CONTRACT_VERSION,
    documentId: "00000000-0000-4000-8000-000000000001",
    selectedConversationId: "00000000-0000-4000-8000-000000000002",
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        title: "Уточнение лаборатории",
        messageCount: 2,
        lastMessagePreview: "В исходнике лаборатория не указана.",
        lastMessageAt: "2026-08-14T12:00:05.000Z",
        createdAt: "2026-08-14T12:00:00.000Z",
        updatedAt: "2026-08-14T12:00:05.000Z",
      },
    ],
    messages: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        role: "user",
        text: "Проверь лабораторию и дату биоматериала.",
        createdAt: "2026-08-14T12:00:00.000Z",
        provenance: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        role: "assistant",
        text: "В исходнике лаборатория не указана. Уточните её название.",
        createdAt: "2026-08-14T12:00:05.000Z",
        provenance: {
          provider: "codex",
          modelId: "gpt-5.4-mini",
          runtimeVersion: "codex-cli 0.147.0",
        },
      },
    ],
    runs: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        title: "Первичный анализ",
        state: "completed",
        attemptCount: 1,
        createdAt: "2026-08-14T11:58:00.000Z",
        completedAt: "2026-08-14T11:58:18.000Z",
        ephemeral: true,
        provenance: {
          provider: "codex",
          modelId: "gpt-5.4-mini",
          runtimeVersion: "codex-cli 0.147.0",
        },
      },
    ],
  } as const satisfies DocumentAgentWorkspaceResponse;

  assert.equal(response.messages[1].provenance?.provider, "codex");
  assert.equal(response.runs[0].ephemeral, true);
  assert.equal(DOCUMENT_AGENT_CONVERSATION_CREATE_COMMAND_SCHEMA.additionalProperties, false);
  assert.equal(DOCUMENT_AGENT_CONVERSATION_CREATE_COMMAND_SCHEMA.properties.title.maxLength, 80);
  assert.equal(DOCUMENT_AGENT_MESSAGE_COMMAND_SCHEMA.additionalProperties, false);
  assert.equal(DOCUMENT_AGENT_MESSAGE_COMMAND_SCHEMA.properties.message.maxLength, 2_000);
});

test("the user-owned vault and connected agent have separate portable contracts", () => {
  assert.equal(VEYLTA_VAULT_CONTRACT_VERSION, "veylta-vault/v1");
  assert.equal(VEYLTA_AGENT_PROTOCOL_VERSION, "veylta-agent/v1");

  const vault = {
    contractVersion: VEYLTA_VAULT_CONTRACT_VERSION,
    vaultId: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-13T12:00:00.000Z",
  } as const satisfies VeyltaVaultManifest;

  const document = {
    contractVersion: VEYLTA_VAULT_CONTRACT_VERSION,
    id: "10000000-0000-4000-8000-000000000002",
    profileId: "10000000-0000-4000-8000-000000000003",
    importedAt: "2026-08-13T12:01:00.000Z",
    mediaType: "application/pdf",
    byteSize: 1024,
    sha256: "a".repeat(64),
    originalFileName: "synthetic-report.pdf",
    sourcePath:
      "profiles/10000000-0000-4000-8000-000000000003/documents/10000000-0000-4000-8000-000000000002/original.pdf",
  } as const satisfies VeyltaVaultDocumentManifest;

  const command = {
    protocolVersion: VEYLTA_AGENT_PROTOCOL_VERSION,
    id: "10000000-0000-4000-8000-000000000004",
    type: "analyze_document",
    vaultId: vault.vaultId,
    profileId: document.profileId,
    documentId: document.id,
    sourceSha256: document.sha256,
    requestedAt: "2026-08-13T12:02:00.000Z",
  } as const satisfies VeyltaAgentCommand;

  assert.equal("token" in vault, false);
  assert.equal("providerCredentials" in document, false);
  assert.equal(command.sourceSha256, document.sha256);

  const queued = {
    protocolVersion: VEYLTA_AGENT_PROTOCOL_VERSION,
    state: "queued",
    command,
    attemptCount: 0,
    queuedAt: "2026-08-13T12:02:01.000Z",
  } as const satisfies VeyltaQueuedAgentCommandRecord;
  assert.equal(queued.state, "queued");
  assert.equal("leaseToken" in queued, false);
});

test("health summary is an explicit evidence snapshot, not a clinical assessment", () => {
  assert.deepEqual(HEALTH_SUMMARY_RECOMMENDATION_CODES, [
    "prepare_source_for_clinician",
    "complete_pending_review",
  ]);

  const response = {
    contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION,
    summary: null,
  } as const satisfies HealthSummaryResponse;

  assert.equal(response.summary, null);

  const history = {
    contractVersion: HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION,
    versions: [],
    nextBeforeVersion: null,
  } as const satisfies HealthSummaryHistoryResponse;
  assert.equal(history.versions.length, 0);

  const comparison = {
    contractVersion: HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION,
    base: {
      id: "10000000-0000-4000-8000-000000000001",
      version: 1,
      createdAt: "2026-08-13T00:00:00.000Z",
    },
    target: {
      id: "10000000-0000-4000-8000-000000000002",
      version: 2,
      createdAt: "2026-08-13T00:01:00.000Z",
    },
    newlyIncluded: [],
    noLongerIncluded: [],
  } as const satisfies HealthSummaryComparisonResponse;
  assert.equal(comparison.target.version, 2);
});

test("family audit log omits internal metadata and exposes explicit pagination", () => {
  assert.equal(MAX_AUDIT_LOG_PAGE_SIZE, 100);
  const response = {
    contractVersion: AUDIT_LOG_CONTRACT_VERSION,
    items: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        action: "profile.created",
        result: "success",
        occurredAt: "2026-08-12T12:00:00.000Z",
        actor: { id: "10000000-0000-4000-8000-000000000002", displayName: "Owner" },
        resource: { type: "PatientProfile", id: "10000000-0000-4000-8000-000000000003" },
      },
    ],
    nextCursor: null,
  } as const satisfies FamilyAuditLogResponse;

  assert.equal("metadata" in response.items[0], false);
  assert.equal("correlationId" in response.items[0], false);
});

test("local invitation distinguishes adult and caregiver access before sharing a profile", () => {
  assert.equal(FAMILY_INVITATION_CONTRACT_VERSION, "family-invitation/v2");
  const response = {
    contractVersion: FAMILY_INVITATION_CONTRACT_VERSION,
    invitation: {
      id: "10000000-0000-4000-8000-000000000001",
      familyId: "10000000-0000-4000-8000-000000000002",
      role: "adult_member",
      code: `vi_${"A".repeat(43)}`,
      expiresAt: "2026-08-13T12:00:00.000Z",
    },
  } as const satisfies FamilyInvitationCreateResponse;

  assert.match(response.invitation.code, /^vi_[A-Za-z0-9_-]{43}$/);
  assert.equal(response.invitation.role, "adult_member");

  const caregiver = {
    contractVersion: FAMILY_INVITATION_CONTRACT_VERSION,
    invitation: {
      id: "10000000-0000-4000-8000-000000000011",
      familyId: "10000000-0000-4000-8000-000000000012",
      role: "caregiver",
      code: `vi_${"B".repeat(43)}`,
      expiresAt: "2026-08-13T12:00:00.000Z",
    },
  } as const satisfies FamilyInvitationCreateResponse;
  assert.equal(caregiver.invitation.role, "caregiver");
});

test("indicator series keeps exact units and its comparison state explicit", () => {
  assert.equal(MAX_INDICATOR_SERIES_PAGE_SIZE, 100);
  assert.deepEqual(SYNTHETIC_INDICATOR_CATALOG, [
    { canonicalCode: "synthetic-analyte-a", displayName: "Синтетический аналит A" },
    { canonicalCode: "synthetic-analyte-b", displayName: "Синтетический аналит B" },
  ]);

  const response = {
    contractVersion: INDICATOR_SERIES_CONTRACT_VERSION,
    indicator: {
      canonicalCode: "synthetic-analyte-a",
      displayName: "Синтетический аналит A",
      unit: "synthetic-unit",
    },
    items: [],
    comparison: { state: "insufficient_data" },
    nextCursor: null,
  } as const satisfies IndicatorSeriesResponse;

  assert.equal(response.indicator.unit, "synthetic-unit");
  assert.equal(response.comparison.state, "insufficient_data");
});

test("observation history keeps confirmed source evidence and pagination explicit", () => {
  assert.equal(MAX_OBSERVATION_HISTORY_PAGE_SIZE, 100);

  const response = {
    contractVersion: OBSERVATION_HISTORY_CONTRACT_VERSION,
    items: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        canonicalCode: null,
        source: { name: "SYNTHETIC_ANALYTE_A", value: "7.0", unit: "synthetic-unit" },
        normalized: { value: null, unit: null, conversionVersion: null },
        referenceRange: {
          sourceText: "5.0–8.0 synthetic-unit",
          sourceLow: null,
          sourceHigh: null,
          sourceUnit: "synthetic-unit",
          laboratoryOutOfRange: null,
          normalizedLow: null,
          normalizedHigh: null,
          normalizedUnit: null,
          conversionVersion: null,
        },
        dates: {
          sampledAt: null,
          resultedAt: null,
          uploadedAt: "2026-08-12T12:00:00.000Z",
        },
        timelineAt: "2026-08-12T12:00:00.000Z",
        specimenType: null,
        laboratory: null,
        extractionConfidence: 0.6,
        confirmed: {
          at: "2026-08-12T12:01:00.000Z",
          by: { id: "10000000-0000-4000-8000-000000000002", displayName: "Reviewer" },
        },
        sourceDocument: {
          id: "10000000-0000-4000-8000-000000000003",
          versionId: "10000000-0000-4000-8000-000000000004",
          pageNumber: 1,
          fragment: "FACT|synthetic-analyte-a",
          contentPath:
            "/v1/families/10000000-0000-4000-8000-000000000005/profiles/10000000-0000-4000-8000-000000000006/documents/10000000-0000-4000-8000-000000000003/content",
        },
      },
    ],
    nextCursor: "eyJ2IjoxfQ",
  } as const satisfies ObservationHistoryResponse;

  assert.equal(response.items[0].source.value, "7.0");
  assert.equal(response.items[0].timelineAt, response.items[0].dates.uploadedAt);
  assert.match(response.items[0].sourceDocument.contentPath, /^\/v1\/families\//);
});

test("fact review contract makes an explicit, versioned human decision", () => {
  assert.deepEqual(FACT_REVIEW_DECISIONS, ["confirm", "correct", "reject"]);
  assert.deepEqual(FACT_REVIEW_OUTCOMES, ["confirmed", "corrected", "rejected"]);
  assert.equal(FACT_REVIEW_COMMAND_SCHEMA.additionalProperties, false);
  assert.deepEqual(FACT_REVIEW_COMMAND_SCHEMA.required, ["factVersion", "decision"]);
  assert.equal(FACT_REVIEW_COMMAND_SCHEMA.properties.factVersion.minimum, 1);
  assert.equal(FACT_REVIEW_COMMAND_SCHEMA.properties.factVersion.maximum, 2_147_483_647);
  assert.equal(FACT_REVIEW_COMMAND_SCHEMA.properties.correction.additionalProperties, false);
  assert.equal(
    FACT_REVIEW_COMMAND_SCHEMA.properties.correction.properties.sourceValue.maxLength,
    100,
  );
  assert.equal(
    FACT_REVIEW_COMMAND_SCHEMA.properties.correction.properties.sourceUnit.maxLength,
    100,
  );
  assert.equal(FACT_REVIEW_COMMAND_SCHEMA.allOf[0]?.then.required[0], "correction");

  const response = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    review: {
      id: "10000000-0000-4000-8000-000000000010",
      factId: "10000000-0000-4000-8000-000000000011",
      factVersion: 1,
      outcome: "corrected",
      decidedAt: "2026-08-12T12:00:00.000Z",
      observationId: "10000000-0000-4000-8000-000000000012",
      decidedBy: {
        id: "10000000-0000-4000-8000-000000000013",
        displayName: "Синтетический проверяющий",
      },
    },
  } as const satisfies FactReviewResponse;

  assert.equal(response.review.outcome, "corrected");
  assert.equal(response.review.observationId === null, false);
});

test("document processing exposes only supported observable states and sanitized failures", () => {
  assert.deepEqual(DOCUMENT_PROCESSING_STATES, [
    "not_started",
    "queued",
    "security_check",
    "text_extraction",
    "document_classification",
    "structured_extraction",
    "validation",
    "awaiting_review",
    "completed",
    "failed",
  ]);
  assert.deepEqual(DOCUMENT_PROCESSING_FAILURE_CATEGORIES, [
    "document_unavailable",
    "invalid_document",
    "agent_unavailable",
    "agent_output_invalid",
    "extraction_failed",
    "validation_failed",
    "attempts_exhausted",
  ]);

  const failed = {
    state: "failed",
    updatedAt: "2026-08-12T12:00:00.000Z",
    category: "attempts_exhausted",
    retryAllowed: true,
  } as const;
  const response = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    documentId: "10000000-0000-4000-8000-000000000001",
    processing: failed,
    activityRunId: "3f2c9a41-5c0b-4a1e-8f7d-2b6c9d0e1a34",
    diagnostics: {
      runId: "3f2c9a41-5c0b-4a1e-8f7d-2b6c9d0e1a34",
      attemptCount: 3,
      maxAttempts: 3,
      stoppedAtStage: "structured_extraction",
      failureCode: "AGENT_OUTPUT_INVALID",
      exchanges: [
        {
          attempt: 3,
          stage: "structured_extraction",
          modelId: "gpt-5.4-mini",
          runtimeVersion: "codex-cli 0.147.0",
          pageCount: 2,
          requestBytes: 4096,
          responseBytes: 2048,
          requestText: '{"pages":[]}',
          responseText: "{}",
          outcome: "rejected",
          rejectionReason: "fragment_not_on_page",
          durationMs: 18_000,
          occurredAt: "2026-08-12T12:00:00.000Z",
        },
      ],
    },
    activity: [
      {
        code: "queued",
        attempt: 0,
        occurredAt: "2026-08-12T11:59:58.000Z",
      },
      {
        code: "failed",
        attempt: 3,
        occurredAt: "2026-08-12T12:00:00.000Z",
      },
    ],
  } satisfies DocumentProcessingResponse;
  const retry = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    documentId: response.documentId,
    processing: {
      state: "queued",
      updatedAt: "2026-08-12T12:00:01.000Z",
    },
  } satisfies DocumentProcessingRetryResponse;

  assert.equal(response.processing.category, "attempts_exhausted");
  assert.deepEqual(DOCUMENT_PROCESSING_EVENT_CODES, [
    "queued",
    "security_check_started",
    "text_extraction_started",
    "document_classification_started",
    "codex_analysis_started",
    "result_validation_started",
    "result_saved",
    "retry_scheduled",
    "failed",
  ]);
  assert.equal(response.activity[1]?.attempt, 3);
  assert.equal(retry.processing.state, "queued");
  assert.equal("message" in response.processing, false);
});

test("document v4 embeds discriminated processing status without changing original status", () => {
  const response = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    document: {
      id: "10000000-0000-4000-8000-000000000001",
      familyId: "10000000-0000-4000-8000-000000000002",
      profileId: "10000000-0000-4000-8000-000000000003",
      status: "uploaded",
      originalFilename: "synthetic.pdf",
      contentType: "application/pdf",
      byteSize: 128,
      sha256: "a".repeat(64),
      uploadedAt: "2026-08-12T12:00:00.000Z",
      duplicate: { possible: false, documentId: null, profileId: null },
      intelligence: {
        contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
        provider: "codex",
        modelId: "gpt-5.4-mini",
        runtimeVersion: "codex-cli 0.147.0",
        category: "laboratory",
        title: "Синтетический лабораторный отчёт",
        shortSummary: "В документе указан один синтетический результат.",
        documentDate: "2026-08-12",
        confidence: 0.96,
      },
      processing: {
        state: "awaiting_review",
        updatedAt: "2026-08-12T12:00:02.000Z",
        factCount: 2,
        needsReviewCount: 1,
      },
    },
  } satisfies DocumentResponse;

  assert.equal(response.document.status, "uploaded");
  assert.deepEqual(DOCUMENT_CATEGORIES, [
    "laboratory",
    "imaging",
    "prescription",
    "discharge_summary",
    "consultation",
    "vaccination",
    "insurance",
    "other",
  ]);
  assert.equal(response.document.intelligence.provider, "codex");
  assert.equal(response.document.processing.state, "awaiting_review");
});

test("lab extraction contract preserves immutable source data and page provenance", () => {
  assert.deepEqual(LAB_FACT_VALIDATION_ISSUES, [
    "LOW_CONFIDENCE",
    "AMBIGUOUS_UNIT",
    "MISSING_UNIT",
    "INVALID_VALUE",
    "INVALID_DATE",
    "INVALID_REFERENCE_RANGE",
    "UNSUPPORTED_ANALYTE",
  ]);

  const extraction = {
    schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
    extractorVersion: "synthetic-lab-text/v1",
    items: [
      {
        factKey: "synthetic-analyte-a",
        sourceName: "SYNTHETIC_ANALYTE_A",
        sourceValue: "7.0",
        sourceUnit: "synthetic-unit",
        proposedCanonicalCode: "synthetic-analyte-a",
        proposedNormalizedValue: null,
        proposedNormalizedUnit: null,
        proposedSampledAt: "2026-08-10T08:00:00.000Z",
        proposedResultedAt: "2026-08-10T10:00:00.000Z",
        proposedSpecimenType: "synthetic specimen",
        proposedLaboratory: "Synthetic Laboratory",
        referenceRange: {
          sourceText: "5.0–8.0 synthetic-unit",
          sourceLow: "5.0",
          sourceHigh: "8.0",
          sourceUnit: "synthetic-unit",
          laboratoryOutOfRange: false,
        },
        confidence: 0.6,
        validationIssues: ["LOW_CONFIDENCE", "AMBIGUOUS_UNIT"],
        source: { pageNumber: 1, fragment: "SYNTHETIC_ANALYTE_A 7.0 synthetic-unit" },
      },
    ],
  } as const satisfies LabExtractionResult;

  const response = {
    schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
    extractionRunId: "10000000-0000-4000-8000-000000000004",
    extractorVersion: extraction.extractorVersion,
    items: [
      {
        ...extraction.items[0],
        id: "10000000-0000-4000-8000-000000000005",
        factVersion: 1,
        canonicalDisplayName: "Синтетический аналит A",
        reviewStatus: "needs_review",
        review: null,
        source: {
          ...extraction.items[0].source,
          documentVersionId: "10000000-0000-4000-8000-000000000006",
          pageTextOrigin: "text_layer",
        },
      },
    ],
  } as const satisfies DocumentFactsResponse;

  assert.equal(response.items[0].source.pageNumber, 1);
  assert.equal(response.items[0].source.documentVersionId.endsWith("6"), true);
  assert.equal(response.items[0].sourceValue, "7.0");
  assert.equal(response.items[0].proposedNormalizedValue, null);
});

test("lab extraction JSON Schema is closed and constrains provenance and confidence", () => {
  assert.equal(LAB_EXTRACTION_RESULT_SCHEMA.$id, "urn:veylta:schema:lab-extraction:v1");
  assert.equal(LAB_EXTRACTION_RESULT_SCHEMA.additionalProperties, false);
  assert.deepEqual(LAB_EXTRACTION_RESULT_SCHEMA.required, [
    "schemaVersion",
    "extractorVersion",
    "items",
  ]);

  const factSchema = LAB_EXTRACTION_RESULT_SCHEMA.properties.items.items;
  assert.equal(factSchema.additionalProperties, false);
  assert.deepEqual(factSchema.properties.validationIssues.items.enum, LAB_FACT_VALIDATION_ISSUES);
  assert.equal(factSchema.properties.confidence.minimum, 0);
  assert.equal(factSchema.properties.confidence.maximum, 1);
  assert.equal(factSchema.properties.source.additionalProperties, false);
  assert.equal(factSchema.properties.source.properties.pageNumber.minimum, 1);
  assert.equal(factSchema.properties.source.properties.fragment.maxLength, 2_000);
});
