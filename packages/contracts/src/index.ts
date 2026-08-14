export const HTTP_API_VERSION = "v1" as const;
export const ACCOUNT_CONTRACT_VERSION = "account/v1" as const;
export const HOME_SETTINGS_CONTRACT_VERSION = "home-settings/v2" as const;
export const OBJECT_STORAGE_CONTRACT_VERSION = "object-storage/v1" as const;
export const LAB_EXTRACTION_SCHEMA_VERSION = "lab-extraction/v1" as const;
export const FAMILY_PROFILE_CONTRACT_VERSION = "family-profile/v2" as const;
export const DOCUMENT_CONTRACT_VERSION = "document/v5" as const;
export const DOCUMENT_INTELLIGENCE_CONTRACT_VERSION = "document-intelligence/v2" as const;
export const DOCUMENT_SEARCH_CONTRACT_VERSION = "document-search/v1" as const;
export const DOCUMENT_LIFECYCLE_CONTRACT_VERSION = "document-lifecycle/v1" as const;
export const DOCUMENT_AGENT_CONTRACT_VERSION = "document-agent/v1" as const;
export const OBSERVATION_HISTORY_CONTRACT_VERSION = "observation-history/v1" as const;
export const INDICATOR_SERIES_CONTRACT_VERSION = "indicator-series/v1" as const;
export const AUDIT_LOG_CONTRACT_VERSION = "audit-log/v1" as const;
export const FAMILY_INVITATION_CONTRACT_VERSION = "family-invitation/v2" as const;
export const PROFILE_CONSENT_CONTRACT_VERSION = "profile-consent/v2" as const;
export const PROFILE_OVERVIEW_CONTRACT_VERSION = "profile-overview/v1" as const;
export const HEALTH_SUMMARY_CONTRACT_VERSION = "health-summary/v1" as const;
export const HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION = "health-summary-history/v1" as const;
export const HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION = "health-summary-comparison/v1" as const;
export const HOME_CARE_PLAN_CONTRACT_VERSION = "home-care-plan/v1" as const;
export const SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION = "synthetic-evidence-bundle/v1" as const;
/**
 * A complete, profile-scoped synthetic export. It is intentionally distinct
 * from the bounded five-source evidence snapshot and is not a production
 * backup, restore, or real-data portability format.
 */
export const SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION = "synthetic-profile-export/v1" as const;
/**
 * A reversible owner-only archive workflow for local demo profiles. Archiving
 * hides a profile and its sources from active access; it never deletes them.
 */
export const PROFILE_ARCHIVE_CONTRACT_VERSION = "profile-archive/v1" as const;
/** Portable, provider-neutral data layout selected and owned by the user. */
export const VEYLTA_VAULT_CONTRACT_VERSION = "veylta-vault/v1" as const;
/** Narrow command/result protocol used by an explicitly connected local agent. */
export const VEYLTA_AGENT_PROTOCOL_VERSION = "veylta-agent/v1" as const;
export const MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS = 5;
/**
 * The complete local profile export fails before sending bytes if a profile
 * exceeds this explicit synthetic-demo cap. It must never silently omit older
 * source documents.
 */
export const MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS = 10;
export const MAX_HEALTH_SUMMARY_EVIDENCE = 50;
export const MAX_HEALTH_SUMMARY_HISTORY_PAGE_SIZE = 50;
export const CARE_PLAN_CATEGORIES = [
  "laboratory",
  "clinician",
  "nutrition",
  "activity",
  "reminder",
] as const;
export const CARE_PLAN_ITEM_STATES = ["proposed", "accepted", "completed", "dismissed"] as const;
export const MAX_SYNTHETIC_DOCUMENT_BYTES = 5 * 1024 * 1024;
/** @deprecated Use MAX_SYNTHETIC_DOCUMENT_BYTES for every supported local source. */
export const MAX_SYNTHETIC_PDF_BYTES = MAX_SYNTHETIC_DOCUMENT_BYTES;
export const MAX_OBSERVATION_HISTORY_PAGE_SIZE = 100;
export const MAX_INDICATOR_SERIES_PAGE_SIZE = 100;
export const MAX_AUDIT_LOG_PAGE_SIZE = 100;
export const MAX_DOCUMENT_INTELLIGENCE_STRUCTURED_RESULTS = 100;

export const DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES = [
  "measurement",
  "genetic_variant",
  "finding",
  "procedure",
  "medication",
  "diagnosis",
  "other",
] as const;
export const DOCUMENT_INTELLIGENCE_RESULT_STATUSES = [
  "above_range",
  "normal",
  "abnormal",
  "detected",
  "not_detected",
  "completed",
  "informational",
  "unknown",
] as const;

export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const CODEX_SERVICE_TIERS = ["standard", "fast"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export type CodexServiceTier = (typeof CODEX_SERVICE_TIERS)[number];

export const VEYLTA_VAULT_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export const VEYLTA_AGENT_COMMAND_TYPES = ["scan_unprocessed", "analyze_document"] as const;
export const VEYLTA_AGENT_COMMAND_STATES = ["queued", "leased", "completed", "failed"] as const;

export type VeyltaVaultMediaType = (typeof VEYLTA_VAULT_MEDIA_TYPES)[number];
export type VeyltaAgentCommandType = (typeof VEYLTA_AGENT_COMMAND_TYPES)[number];

/**
 * Public root metadata. Credentials, provider tokens, local bridge tokens, and
 * absolute machine paths are intentionally not part of the portable vault.
 */
export interface VeyltaVaultManifest {
  readonly contractVersion: typeof VEYLTA_VAULT_CONTRACT_VERSION;
  readonly vaultId: string;
  readonly createdAt: string;
}

/** Immutable source selector stored next to one user-owned original. */
export interface VeyltaVaultDocumentManifest {
  readonly contractVersion: typeof VEYLTA_VAULT_CONTRACT_VERSION;
  readonly id: string;
  readonly profileId: string;
  readonly importedAt: string;
  readonly mediaType: VeyltaVaultMediaType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly originalFileName: string;
  /** Slash-separated path relative to the vault root. */
  readonly sourcePath: string;
}

interface VeyltaAgentCommandBase {
  readonly protocolVersion: typeof VEYLTA_AGENT_PROTOCOL_VERSION;
  readonly id: string;
  readonly vaultId: string;
  readonly requestedAt: string;
}

export interface VeyltaScanUnprocessedCommand extends VeyltaAgentCommandBase {
  readonly type: "scan_unprocessed";
  readonly profileId?: string;
}

export interface VeyltaAnalyzeDocumentCommand extends VeyltaAgentCommandBase {
  readonly type: "analyze_document";
  readonly profileId: string;
  readonly documentId: string;
  /** Binds every result to the exact immutable input version. */
  readonly sourceSha256: string;
}

export type VeyltaAgentCommand = VeyltaScanUnprocessedCommand | VeyltaAnalyzeDocumentCommand;

export interface VeyltaQueuedAgentCommandRecord {
  readonly protocolVersion: typeof VEYLTA_AGENT_PROTOCOL_VERSION;
  readonly state: "queued";
  readonly command: VeyltaAgentCommand;
  readonly attemptCount: number;
  readonly queuedAt: string;
}

export interface VeyltaLeasedAgentCommandRecord {
  readonly protocolVersion: typeof VEYLTA_AGENT_PROTOCOL_VERSION;
  readonly state: "leased";
  readonly command: VeyltaAgentCommand;
  readonly attemptCount: number;
  readonly queuedAt: string;
  readonly workerId: string;
  /** One-way digest; the raw lease token is never synchronized in the vault. */
  readonly leaseTokenHash: string;
  readonly leasedAt: string;
  readonly leaseExpiresAt: string;
}

export interface VeyltaCompletedAgentCommandRecord {
  readonly protocolVersion: typeof VEYLTA_AGENT_PROTOCOL_VERSION;
  readonly state: "completed";
  readonly command: VeyltaAgentCommand;
  readonly attemptCount: number;
  readonly queuedAt: string;
  readonly completedAt: string;
}

export interface VeyltaFailedAgentCommandRecord {
  readonly protocolVersion: typeof VEYLTA_AGENT_PROTOCOL_VERSION;
  readonly state: "failed";
  readonly command: VeyltaAgentCommand;
  readonly attemptCount: number;
  readonly queuedAt: string;
  /** Sanitized machine code only; no document values or prompt text. */
  readonly failureCode: string;
  readonly failedAt: string;
}

export type VeyltaAgentCommandRecord =
  | VeyltaQueuedAgentCommandRecord
  | VeyltaLeasedAgentCommandRecord
  | VeyltaCompletedAgentCommandRecord
  | VeyltaFailedAgentCommandRecord;

/**
 * The only canonical codes the deterministic synthetic parser can propose.
 * They are demonstration identifiers, not clinical vocabularies or diagnoses.
 */
export const SYNTHETIC_INDICATOR_CATALOG = [
  { canonicalCode: "synthetic-analyte-a", displayName: "Синтетический аналит A" },
  { canonicalCode: "synthetic-analyte-b", displayName: "Синтетический аналит B" },
] as const;

export const DOCUMENT_PROCESSING_STATES = [
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
] as const;

export const DOCUMENT_PROCESSING_FAILURE_CATEGORIES = [
  "document_unavailable",
  "invalid_document",
  "agent_unavailable",
  "agent_output_invalid",
  "extraction_failed",
  "validation_failed",
  "attempts_exhausted",
] as const;

/**
 * Safe, payload-free facts recorded by the worker as processing advances.
 * These are observable state transitions, never model reasoning or source text.
 */
export const DOCUMENT_PROCESSING_EVENT_CODES = [
  "queued",
  "security_check_started",
  "text_extraction_started",
  "document_classification_started",
  "codex_analysis_started",
  "result_validation_started",
  "result_saved",
  "retry_scheduled",
  "failed",
] as const;

export const DOCUMENT_CATEGORIES = [
  "laboratory",
  "imaging",
  "prescription",
  "discharge_summary",
  "consultation",
  "vaccination",
  "insurance",
  "other",
] as const;

export const LAB_FACT_VALIDATION_ISSUES = [
  "LOW_CONFIDENCE",
  "AMBIGUOUS_UNIT",
  "MISSING_UNIT",
  "INVALID_VALUE",
  "INVALID_DATE",
  "INVALID_REFERENCE_RANGE",
  "UNSUPPORTED_ANALYTE",
] as const;

export const FACT_REVIEW_DECISIONS = ["confirm", "correct", "reject"] as const;
export const FACT_REVIEW_OUTCOMES = ["confirmed", "corrected", "rejected"] as const;
export const HEALTH_SUMMARY_RECOMMENDATION_CODES = [
  "prepare_source_for_clinician",
  "complete_pending_review",
] as const;

export interface HealthStatus {
  status: "ok" | "unavailable";
  service: "api" | "worker";
  version: string;
}

export type FamilyRole = "owner" | "adult_member" | "caregiver";
export type AppAccountRole = "admin" | "user";
export type FamilyInvitationRole = "adult_member" | "caregiver";
export type PatientProfileKind = "adult" | "dependent";
export type PatientProfileAccess = "owner" | "self" | "granted_read";

export interface FamilySummary {
  id: string;
  displayName: string;
  role: FamilyRole;
  createdAt: string;
}

export interface PatientProfileSummary {
  id: string;
  familyId: string;
  displayName: string;
  kind: PatientProfileKind;
  /** The server-authorized scope this session has for the profile. */
  access: PatientProfileAccess;
  createdAt: string;
}

export interface AppAccountUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: AppAccountRole;
}

export interface SetupStatusResponse {
  readonly contractVersion: typeof ACCOUNT_CONTRACT_VERSION;
  readonly setupRequired: boolean;
}

export interface AdminSetupRequest {
  readonly username: string;
  readonly password: string;
  readonly displayName: string;
}

export interface AdminSetupResponse {
  readonly contractVersion: typeof ACCOUNT_CONTRACT_VERSION;
  readonly user: AppAccountUser;
  readonly family: FamilySummary;
  readonly profile: PatientProfileSummary;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

export interface LoginResponse {
  readonly contractVersion: typeof ACCOUNT_CONTRACT_VERSION;
  readonly user: AppAccountUser;
}

export interface ManagedAccount {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: AppAccountRole;
  readonly status: "active" | "disabled";
}

export interface ManagedAccountCreateRequest {
  readonly username: string;
  readonly password: string;
  readonly displayName: string;
  readonly role: AppAccountRole;
}

export interface ManagedAccountCreateResponse {
  readonly contractVersion: typeof HOME_SETTINGS_CONTRACT_VERSION;
  readonly account: ManagedAccount;
  readonly profile: PatientProfileSummary;
}

export interface CodexRuntimeStatus {
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly authenticationMode: "chatgpt" | "api_key" | "unknown" | null;
  readonly authenticationOwner: "codex_cli";
  readonly daemonRunning: boolean;
  readonly cliVersion: string | null;
  readonly runtimeVersion: string | null;
  readonly preference: CodexExecutionPreference;
  readonly models: readonly CodexModelOption[];
  readonly usageLimits: readonly CodexUsageLimit[];
  readonly experimental: true;
}

export interface CodexExecutionPreference {
  readonly modelId: string;
  readonly reasoningEffort: CodexReasoningEffort;
  readonly serviceTier: CodexServiceTier;
}

export interface CodexModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: CodexReasoningEffort;
  readonly supportedReasoningEfforts: readonly CodexReasoningEffort[];
  readonly supportsFastMode: boolean;
  readonly upgradeModelId: string | null;
}

export interface CodexUsageLimit {
  readonly name: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly windowDurationMinutes: number;
  readonly resetsAt: string;
}

export interface CodexPreferenceUpdateRequest extends CodexExecutionPreference {}

export interface CodexPreferenceUpdateResponse {
  readonly contractVersion: typeof HOME_SETTINGS_CONTRACT_VERSION;
  readonly codex: CodexRuntimeStatus;
}

export interface HomeStorageStatus {
  readonly driver: "local" | "s3";
  readonly rootPath: string | null;
  readonly state: "stable" | "copying" | "failed";
  readonly targetRootPath: string | null;
  readonly generation: number;
  readonly relocationSupported: boolean;
  readonly lastFailureCode: "TARGET_INVALID" | "COPY_FAILED" | "VERIFY_FAILED" | null;
}

export interface HomeSettingsResponse {
  readonly contractVersion: typeof HOME_SETTINGS_CONTRACT_VERSION;
  readonly codex: CodexRuntimeStatus;
  readonly storage: HomeStorageStatus;
  readonly accounts: readonly ManagedAccount[];
}

export interface StorageRelocationRequest {
  readonly rootPath: string;
}

export interface StorageRelocationResponse {
  readonly contractVersion: typeof HOME_SETTINGS_CONTRACT_VERSION;
  readonly storage: HomeStorageStatus;
}

export interface CodexRuntimeActionResponse {
  readonly contractVersion: typeof HOME_SETTINGS_CONTRACT_VERSION;
  readonly codex: CodexRuntimeStatus;
}

export interface DemoRegistrationRequest {
  displayName: string;
  familyName: string;
  profileName: string;
}

export interface DemoRegistrationResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  family: FamilySummary;
  profile: PatientProfileSummary;
}

export interface ProfileListResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  items: PatientProfileSummary[];
}

export interface ProfileCreateResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  profile: PatientProfileSummary;
}

export interface ProfileArchiveResponse {
  readonly contractVersion: typeof PROFILE_ARCHIVE_CONTRACT_VERSION;
  readonly profileId: string;
  readonly archivedAt: string;
}

export interface ProfileRestoreResponse {
  readonly contractVersion: typeof PROFILE_ARCHIVE_CONTRACT_VERSION;
  readonly profileId: string;
  readonly restoredAt: string;
}

export interface ArchivedProfileSummary {
  readonly id: string;
  readonly familyId: string;
  readonly displayName: string;
  readonly kind: PatientProfileKind;
  readonly archivedAt: string;
}

export interface ArchivedProfileListResponse {
  readonly contractVersion: typeof PROFILE_ARCHIVE_CONTRACT_VERSION;
  readonly items: readonly ArchivedProfileSummary[];
}

/**
 * Local-demo invitation flow. The code is returned exactly once to the owner;
 * the database retains only its SHA-256 hash.
 */
export interface FamilyInvitationCreateRequest {
  readonly role: FamilyInvitationRole;
}

export interface FamilyInvitationCreateResponse {
  readonly contractVersion: typeof FAMILY_INVITATION_CONTRACT_VERSION;
  readonly invitation: {
    readonly id: string;
    readonly familyId: string;
    readonly role: FamilyInvitationRole;
    readonly code: string;
    readonly expiresAt: string;
  };
}

export interface DemoInvitationAcceptRequest {
  readonly code: string;
  readonly displayName: string;
  /** Required only for an adult-member invitation; caregivers leave it absent. */
  readonly profileName?: string;
}

export interface DemoInvitationAcceptResponse {
  readonly contractVersion: typeof FAMILY_INVITATION_CONTRACT_VERSION;
  readonly family: FamilySummary;
  /** Caregivers start with no profile until an owner explicitly grants one. */
  readonly profile: PatientProfileSummary | null;
}

export interface FamilyConsentMember {
  readonly id: string;
  readonly displayName: string;
  readonly role: FamilyInvitationRole;
}

export interface FamilyConsentMemberListResponse {
  readonly contractVersion: typeof PROFILE_CONSENT_CONTRACT_VERSION;
  readonly items: readonly FamilyConsentMember[];
}

export interface ProfileConsentGrantCreateRequest {
  readonly granteeUserId: string;
  readonly capability: "profile.read";
}

export interface ProfileConsentGrant {
  readonly id: string;
  readonly familyId: string;
  readonly profileId: string;
  readonly capability: "profile.read";
  readonly grantee: FamilyConsentMember;
  readonly createdAt: string;
}

export interface ProfileConsentGrantCreateResponse {
  readonly contractVersion: typeof PROFILE_CONSENT_CONTRACT_VERSION;
  readonly grant: ProfileConsentGrant;
}

export interface ProfileConsentGrantListResponse {
  readonly contractVersion: typeof PROFILE_CONSENT_CONTRACT_VERSION;
  readonly items: readonly ProfileConsentGrant[];
}

/**
 * Minimal, payload-free family audit projection. Metadata and correlation IDs
 * remain internal operational records and are intentionally never serialized.
 */
export interface FamilyAuditEvent {
  readonly id: string;
  readonly action: string;
  readonly result: "success" | "denied" | "failed";
  readonly occurredAt: string;
  readonly actor: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly resource: {
    readonly type: string;
    readonly id: string;
  };
}

export interface FamilyAuditLogResponse {
  readonly contractVersion: typeof AUDIT_LOG_CONTRACT_VERSION;
  readonly items: readonly FamilyAuditEvent[];
  /** Opaque cursor for the next page, or null on the final page. */
  readonly nextCursor: string | null;
}

export interface SessionFamily extends FamilySummary {
  profiles: PatientProfileSummary[];
}

export interface SessionResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  user: {
    id: string;
    /** Null only for legacy local-demo sessions created before account setup. */
    username: string | null;
    displayName: string;
    /** Null only for legacy local-demo sessions created before account setup. */
    role: AppAccountRole | null;
  };
  families: SessionFamily[];
}

export type DocumentStatus = "uploaded";
export type SyntheticDocumentContentType = "application/pdf" | "image/png" | "image/jpeg";
export type DocumentProcessingState = (typeof DOCUMENT_PROCESSING_STATES)[number];
export type DocumentProcessingFailureCategory =
  (typeof DOCUMENT_PROCESSING_FAILURE_CATEGORIES)[number];
export type DocumentProcessingEventCode = (typeof DOCUMENT_PROCESSING_EVENT_CODES)[number];
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export type DocumentIntelligenceStructuredResultType =
  (typeof DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES)[number];
export type DocumentIntelligenceResultStatus =
  (typeof DOCUMENT_INTELLIGENCE_RESULT_STATUSES)[number];

/**
 * Immutable semantic metadata proposed by the configured document-intelligence
 * provider. It classifies the source; it is not a diagnosis or a confirmed
 * observation.
 */
export interface DocumentIntelligenceSummary {
  readonly contractVersion: typeof DOCUMENT_INTELLIGENCE_CONTRACT_VERSION;
  readonly provider: "codex";
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly category: DocumentCategory;
  readonly title: string;
  readonly shortSummary: string;
  readonly documentDate: string | null;
  readonly confidence: number;
}

/** Exact source evidence for one generic result proposed by document intelligence. */
export interface DocumentIntelligenceSource {
  readonly pageNumber: number;
  readonly fragment: string;
}

/**
 * A provider-neutral source result. Optional value fields stay null when the
 * document states only a named finding, procedure, medication, or diagnosis.
 */
export interface DocumentIntelligenceStructuredResult {
  readonly resultKey: string;
  readonly type: DocumentIntelligenceStructuredResultType;
  readonly label: string;
  readonly value: string | null;
  readonly unit: string | null;
  readonly code: string | null;
  readonly lab: string | null;
  readonly specimen: string | null;
  readonly date: string | null;
  /** Source-derived only; above_range requires an explicit source flag or printed reference range. */
  readonly status: DocumentIntelligenceResultStatus;
  readonly confidence: number;
  readonly source: DocumentIntelligenceSource;
}

/** Full immutable v2 result; summaries remain proposals until a human reviews source evidence. */
export interface DocumentIntelligenceResult extends DocumentIntelligenceSummary {
  readonly detailedSummary: string;
  readonly structuredResults: readonly DocumentIntelligenceStructuredResult[];
}

export interface DocumentProcessingNotStarted {
  readonly state: "not_started";
}

export interface DocumentProcessingQueued {
  readonly state: "queued";
  readonly updatedAt: string;
}

export interface DocumentProcessingActive {
  readonly state:
    | "security_check"
    | "text_extraction"
    | "document_classification"
    | "structured_extraction"
    | "validation";
  readonly updatedAt: string;
}

export interface DocumentProcessingAwaitingReview {
  readonly state: "awaiting_review";
  readonly updatedAt: string;
  readonly factCount: number;
  readonly needsReviewCount: number;
}

export interface DocumentProcessingCompleted {
  readonly state: "completed";
  readonly updatedAt: string;
  readonly factCount: number;
}

export interface DocumentProcessingFailed {
  readonly state: "failed";
  readonly updatedAt: string;
  readonly category: DocumentProcessingFailureCategory;
  readonly retryAllowed: boolean;
}

export type DocumentProcessingStatus =
  | DocumentProcessingNotStarted
  | DocumentProcessingQueued
  | DocumentProcessingActive
  | DocumentProcessingAwaitingReview
  | DocumentProcessingCompleted
  | DocumentProcessingFailed;

export interface DocumentSummary {
  id: string;
  familyId: string;
  profileId: string;
  status: DocumentStatus;
  originalFilename: string;
  contentType: SyntheticDocumentContentType;
  byteSize: number;
  sha256: string;
  uploadedAt: string;
  duplicate: {
    possible: boolean;
    documentId: string | null;
    profileId: string | null;
  };
  readonly intelligence: DocumentIntelligenceSummary | null;
  processing: DocumentProcessingStatus;
}

export interface DocumentResponse {
  contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  document: DocumentSummary;
}

export type DocumentUploadDisposition = "created" | "already_exists";

export interface DocumentUploadResponse extends DocumentResponse {
  readonly disposition: DocumentUploadDisposition;
}

export type DocumentDetail = Omit<DocumentSummary, "intelligence"> & {
  readonly intelligence: DocumentIntelligenceResult | null;
};

export interface DocumentDetailResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly document: DocumentDetail;
}

export interface DocumentSearchResponse {
  readonly contractVersion: typeof DOCUMENT_SEARCH_CONTRACT_VERSION;
  readonly documents: readonly DocumentSummary[];
}

/** Receipt for removal from active Veylta reads; not a physical-erasure claim. */
export interface DocumentDeleteResponse {
  readonly contractVersion: typeof DOCUMENT_LIFECYCLE_CONTRACT_VERSION;
  readonly documentId: string;
  readonly deletedAt: string;
}

export interface DocumentProcessingResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly processing: DocumentProcessingStatus;
  readonly activity: readonly DocumentProcessingActivityEvent[];
}

export interface DocumentProcessingActivityEvent {
  readonly code: DocumentProcessingEventCode;
  /** Zero means queued; positive values identify a real worker attempt. */
  readonly attempt: number;
  readonly occurredAt: string;
}

export interface DocumentProcessingRetryResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly processing: DocumentProcessingQueued;
}

/** A fresh immutable analysis run; prior runs and confirmed observations remain intact. */
export interface DocumentProcessingRestartResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly processing: DocumentProcessingQueued;
}

export type DocumentAgentMessageRole = "user" | "assistant";

export interface DocumentAgentMessage {
  readonly id: string;
  readonly role: DocumentAgentMessageRole;
  /** User and assistant dialogue is Russian; verbatim document evidence stays in source fields. */
  readonly text: string;
  readonly createdAt: string;
  readonly provenance: {
    readonly provider: "codex";
    readonly modelId: string;
    readonly runtimeVersion: string;
  } | null;
}

export interface DocumentAgentConversationResponse {
  readonly contractVersion: typeof DOCUMENT_AGENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly conversationId: string | null;
  readonly messages: readonly DocumentAgentMessage[];
}

export interface DocumentAgentMessageCommand {
  readonly message: string;
}

export const DOCUMENT_AGENT_MESSAGE_COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: {
      type: "string",
      minLength: 1,
      maxLength: 2_000,
      pattern: "^\\S(?:[\\s\\S]*\\S)?$",
    },
  },
} as const;

/**
 * A bounded, source-first profile landing view. It deliberately contains no
 * diagnosis, health score, recommendation, or inferred clinical status.
 */
export interface ProfileOverviewDocument {
  readonly id: string;
  readonly originalFilename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly uploadedAt: string;
  readonly intelligence: DocumentIntelligenceSummary | null;
  readonly processing: DocumentProcessingStatus;
}

/** A document with raw facts that still require an explicit final decision. */
export interface ProfileOverviewReviewDocument {
  readonly id: string;
  readonly originalFilename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly uploadedAt: string;
  readonly pendingFactCount: number;
  readonly needsAttentionFactCount: number;
}

export interface ProfileOverviewResponse {
  readonly contractVersion: typeof PROFILE_OVERVIEW_CONTRACT_VERSION;
  readonly profile: PatientProfileSummary;
  /** Newest first; bounded to fifty immutable source documents. */
  readonly recentDocuments: readonly ProfileOverviewDocument[];
  readonly reviewQueue: {
    readonly documentCount: number;
    readonly pendingFactCount: number;
    readonly needsAttentionFactCount: number;
    /** Newest first; bounded to three source documents that need review. */
    readonly documents: readonly ProfileOverviewReviewDocument[];
  };
  /** Newest first; bounded to three explicitly confirmed source values. */
  readonly recentObservations: readonly ObservationHistoryItem[];
}

/**
 * A deliberately narrow, immutable snapshot made after a completed source
 * review. It groups only explicitly confirmed evidence; it never diagnoses,
 * estimates risk, or evaluates urgent symptoms.
 */
export interface HealthSummaryGroup {
  readonly id: "synthetic_laboratory" | "other_confirmed_source";
  readonly label: string;
  readonly evidence: readonly HealthSummaryEvidence[];
}

export interface HealthSummaryEvidence {
  /** True only when this source was absent from the previous summary snapshot. */
  readonly isNewSincePreviousSummary: boolean;
  readonly observation: ObservationHistoryItem;
}

export type HealthSummaryMissingData =
  | "confirmed_observations"
  | "sample_date"
  | "result_date"
  | "laboratory"
  | "canonical_indicator";

export type HealthSummaryRecommendationCode = (typeof HEALTH_SUMMARY_RECOMMENDATION_CODES)[number];

/**
 * A recommendation code is intentionally operational, not medical advice.
 * UI copy must preserve that distinction and link to its source evidence.
 */
export interface HealthSummaryRecommendation {
  readonly code: HealthSummaryRecommendationCode;
}

export interface HealthSummary {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly previous: {
    readonly id: string;
    readonly version: number;
    readonly createdAt: string;
  } | null;
  /** The immutable snapshot is bounded; the total makes any omitted history explicit. */
  readonly evidenceScope: {
    readonly includedCount: number;
    readonly totalConfirmedObservationCount: number;
  };
  readonly groups: readonly HealthSummaryGroup[];
  readonly newEvidenceCount: number;
  readonly carriedForwardEvidenceCount: number;
  readonly missingData: readonly HealthSummaryMissingData[];
  readonly recommendations: readonly HealthSummaryRecommendation[];
  /** A local synthetic summary never performs an urgent-symptom or red-flag evaluation. */
  readonly redFlagStatus: "not_evaluated";
}

export interface HealthSummaryResponse {
  readonly contractVersion: typeof HEALTH_SUMMARY_CONTRACT_VERSION;
  /** Null until at least one extraction run reaches its final human review. */
  readonly summary: HealthSummary | null;
}

/**
 * A compact, newest-first index of immutable summary snapshots. It contains
 * counts only, so selecting an older version never introduces a health score
 * or an interpretation of change.
 */
export interface HealthSummaryVersion {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly includedEvidenceCount: number;
  readonly totalConfirmedObservationCount: number;
  readonly newEvidenceCount: number;
  readonly carriedForwardEvidenceCount: number;
}

export interface HealthSummaryHistoryResponse {
  readonly contractVersion: typeof HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION;
  readonly versions: readonly HealthSummaryVersion[];
  /** Pass this immutable version number as `beforeVersion` for the next older page. */
  readonly nextBeforeVersion: number | null;
}

/**
 * An explicit source-set delta between two immutable summary snapshots. It
 * reports only what each fixed snapshot includes; it is never a health change,
 * trend, diagnosis, or recommendation.
 */
export interface HealthSummaryComparisonResponse {
  readonly contractVersion: typeof HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION;
  readonly base: {
    readonly id: string;
    readonly version: number;
    readonly createdAt: string;
  };
  readonly target: {
    readonly id: string;
    readonly version: number;
    readonly createdAt: string;
  };
  /** Confirmed source observations present in target but absent from base. */
  readonly newlyIncluded: readonly ObservationHistoryItem[];
  /** Confirmed source observations present in base but absent from target. */
  readonly noLongerIncluded: readonly ObservationHistoryItem[];
}

export type CarePlanCategory = (typeof CARE_PLAN_CATEGORIES)[number];
export type CarePlanItemState = (typeof CARE_PLAN_ITEM_STATES)[number];

/**
 * Source binding for an agent/rule proposal. User-authored actions have null
 * provenance and are never presented as source-derived recommendations.
 */
export interface CarePlanProvenance {
  readonly proposalRunId: string;
  readonly healthSummary: {
    readonly id: string;
    readonly version: number;
  };
  readonly sourceObservationId: string | null;
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly ruleVersion: string;
  readonly missingContext: readonly string[];
}

export interface CarePlanItem {
  readonly id: string;
  readonly category: CarePlanCategory;
  readonly title: string;
  readonly note: string | null;
  readonly scheduledFor: string | null;
  readonly state: CarePlanItemState;
  readonly origin: "user" | "codex";
  readonly revision: number;
  readonly provenance: CarePlanProvenance | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CarePlanResponse {
  readonly contractVersion: typeof HOME_CARE_PLAN_CONTRACT_VERSION;
  readonly profileId: string;
  readonly canWrite: boolean;
  readonly evidence: {
    readonly sourceCount: number;
    readonly pendingReviewCount: number;
    readonly confirmedObservationCount: number;
    readonly latestSummary: {
      readonly id: string;
      readonly version: number;
      readonly createdAt: string;
    } | null;
  };
  readonly items: readonly CarePlanItem[];
}

export interface CarePlanItemCreateRequest {
  readonly category: CarePlanCategory;
  readonly title: string;
  readonly note: string | null;
  /** Local calendar date in canonical YYYY-MM-DD form. */
  readonly scheduledFor: string | null;
}

export interface CarePlanItemStateRequest {
  readonly revision: number;
  readonly state: "accepted" | "completed" | "dismissed";
  readonly scheduledFor: string | null;
}

export interface CarePlanItemResponse {
  readonly contractVersion: typeof HOME_CARE_PLAN_CONTRACT_VERSION;
  readonly profileId: string;
  readonly item: CarePlanItem;
}

export interface CarePlanProposalRequest {
  /** Explicit acknowledgement that the confirmed summary is sent to the Codex model service. */
  readonly acknowledgement: "send_confirmed_summary_to_codex";
}

export interface CarePlanProposalRun {
  readonly id: string;
  readonly healthSummary: {
    readonly id: string;
    readonly version: number;
  };
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly ruleVersion: string;
  readonly proposalCount: number;
  readonly completedAt: string;
}

export interface CarePlanProposalResponse {
  readonly contractVersion: typeof HOME_CARE_PLAN_CONTRACT_VERSION;
  readonly profileId: string;
  /** True when the exact summary/model/rule result was already stored. */
  readonly replayed: boolean;
  readonly run: CarePlanProposalRun;
  readonly items: readonly CarePlanItem[];
}

/**
 * A local, owner/self-authorized portable bundle. It is deliberately limited
 * to the checked-in synthetic demo boundary and is not a backup format.
 */
export interface SyntheticEvidenceBundleDocument {
  readonly id: string;
  readonly versionId: string;
  readonly originalFilename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly uploadedAt: string;
  /** Safe bundle-relative path; never a storage key or a user filename. */
  readonly archivePath: string;
}

export type SyntheticEvidenceBundleObservation = Omit<ObservationHistoryItem, "sourceDocument"> & {
  readonly sourceDocument: Omit<ObservationHistoryItem["sourceDocument"], "contentPath"> & {
    readonly archivePath: string;
  };
};

export interface SyntheticEvidenceBundleManifest {
  readonly contractVersion: typeof SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION;
  readonly exportedAt: string;
  readonly profile: Omit<PatientProfileSummary, "access">;
  readonly documents: readonly SyntheticEvidenceBundleDocument[];
  readonly observations: readonly SyntheticEvidenceBundleObservation[];
}

/**
 * A complete, local synthetic profile snapshot. Every retained source document
 * and confirmed observation must appear together or the request fails; it is
 * not a restore/backup or production portability format.
 */
export interface SyntheticProfileExportManifest {
  readonly contractVersion: typeof SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION;
  readonly exportedAt: string;
  readonly profile: Omit<PatientProfileSummary, "access">;
  readonly documents: readonly SyntheticEvidenceBundleDocument[];
  readonly observations: readonly SyntheticEvidenceBundleObservation[];
}

export type LabFactValidationIssue = (typeof LAB_FACT_VALIDATION_ISSUES)[number];
export type ExtractedFactReviewStatus = "extracted" | "needs_review" | "confirmed" | "rejected";
export type FactReviewDecision = (typeof FACT_REVIEW_DECISIONS)[number];
export type FactReviewOutcome = (typeof FACT_REVIEW_OUTCOMES)[number];

export interface LabFactReferenceRange {
  readonly sourceText: string | null;
  readonly sourceLow: string | null;
  readonly sourceHigh: string | null;
  readonly sourceUnit: string | null;
  readonly laboratoryOutOfRange: boolean | null;
}

export interface LabFactPageSource {
  readonly pageNumber: number;
  readonly fragment: string;
}

export interface LabExtractionFact {
  readonly factKey: string;
  readonly sourceName: string;
  readonly sourceValue: string;
  readonly sourceUnit: string;
  readonly proposedCanonicalCode: string | null;
  readonly proposedNormalizedValue: string | null;
  readonly proposedNormalizedUnit: string | null;
  readonly proposedSampledAt: string | null;
  readonly proposedResultedAt: string | null;
  readonly proposedSpecimenType: string | null;
  readonly proposedLaboratory: string | null;
  readonly referenceRange: LabFactReferenceRange | null;
  readonly confidence: number;
  readonly validationIssues: readonly LabFactValidationIssue[];
  readonly source: LabFactPageSource;
}

export interface LabExtractionResult {
  readonly schemaVersion: typeof LAB_EXTRACTION_SCHEMA_VERSION;
  readonly extractorVersion: string;
  readonly items: readonly LabExtractionFact[];
}

export interface ExtractedLabFact extends LabExtractionFact {
  readonly id: string;
  readonly factVersion: number;
  /** Russian household display name from the confirmed local analyte catalog. */
  readonly canonicalDisplayName: string | null;
  readonly reviewStatus: ExtractedFactReviewStatus;
  /** Null until an explicit immutable review decision has been stored. */
  readonly review: ExtractedFactReviewSummary | null;
  readonly source: LabFactPageSource & {
    readonly documentVersionId: string;
  };
}

export interface DocumentFactsResponse {
  readonly schemaVersion: typeof LAB_EXTRACTION_SCHEMA_VERSION;
  readonly extractionRunId: string;
  readonly extractorVersion: string;
  readonly items: readonly ExtractedLabFact[];
}

export interface FactReviewCorrection {
  readonly sourceName: string;
  readonly sourceValue: string;
  readonly sourceUnit: string;
}

/** The immutable final decision exposed with its source fact on authorized reads. */
export interface ExtractedFactReviewSummary {
  readonly id: string;
  readonly outcome: FactReviewOutcome;
  readonly decidedAt: string;
  /** The family member whose explicit decision created this immutable review. */
  readonly decidedBy: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly observationId: string | null;
  /** Present only when the final decision is a correction. */
  readonly correction: FactReviewCorrection | null;
}

export interface FactReviewCommand {
  readonly factVersion: number;
  readonly decision: FactReviewDecision;
  readonly correction?: FactReviewCorrection;
}

export interface FactReviewSummary {
  readonly id: string;
  readonly factId: string;
  readonly factVersion: number;
  readonly outcome: FactReviewOutcome;
  readonly decidedAt: string;
  /** The family member whose explicit decision created this immutable review. */
  readonly decidedBy: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly observationId: string | null;
}

export interface FactReviewResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly review: FactReviewSummary;
}

/**
 * A source-specific range attached to one immutable confirmed observation.
 * It is intentionally distinct from a universal or canonical reference range.
 */
export interface ObservationHistoryReferenceRange {
  readonly sourceText: string | null;
  readonly sourceLow: string | null;
  readonly sourceHigh: string | null;
  readonly sourceUnit: string | null;
  readonly laboratoryOutOfRange: boolean | null;
  readonly normalizedLow: string | null;
  readonly normalizedHigh: string | null;
  readonly normalizedUnit: string | null;
  readonly conversionVersion: string | null;
}

/** A source-first, immutable view of one explicitly confirmed observation. */
export interface ObservationHistoryItem {
  readonly id: string;
  readonly canonicalCode: string | null;
  readonly source: {
    readonly name: string;
    readonly value: string;
    readonly unit: string;
  };
  readonly normalized: {
    readonly value: string | null;
    readonly unit: string | null;
    readonly conversionVersion: string | null;
  };
  readonly referenceRange: ObservationHistoryReferenceRange | null;
  readonly dates: {
    readonly sampledAt: string | null;
    readonly resultedAt: string | null;
    readonly uploadedAt: string;
  };
  /** The deterministic history sort date: sampled, then resulted, then uploaded. */
  readonly timelineAt: string;
  readonly specimenType: string | null;
  readonly laboratory: string | null;
  readonly extractionConfidence: number;
  readonly confirmed: {
    readonly at: string;
    readonly by: {
      readonly id: string;
      readonly displayName: string;
    };
  };
  readonly sourceDocument: {
    readonly id: string;
    readonly versionId: string;
    readonly pageNumber: number;
    readonly fragment: string;
    /** Relative, re-authorized endpoint for the immutable original document. */
    readonly contentPath: string;
  };
}

export interface ObservationHistoryResponse {
  readonly contractVersion: typeof OBSERVATION_HISTORY_CONTRACT_VERSION;
  readonly items: readonly ObservationHistoryItem[];
  /** Opaque cursor for the next page, or null when this is the final page. */
  readonly nextCursor: string | null;
}

/** The latest confirmed value for one exact source unit. */
export interface IndicatorUnitSummary {
  readonly unit: string;
  readonly observationCount: number;
  readonly latest: {
    readonly value: string;
    readonly timelineAt: string;
  };
}

/** A catalog row only exists when the profile has confirmed observations for it. */
export interface IndicatorCatalogItem {
  readonly canonicalCode: string;
  readonly displayName: string;
  /** Units remain separate; the API never silently converts or mixes them. */
  readonly units: readonly IndicatorUnitSummary[];
}

export interface IndicatorCatalogResponse {
  readonly contractVersion: typeof INDICATOR_SERIES_CONTRACT_VERSION;
  readonly items: readonly IndicatorCatalogItem[];
}

export type IndicatorComparison =
  | { readonly state: "insufficient_data" }
  | {
      readonly state: "unavailable";
      readonly reason: "non_numeric_source_value";
    }
  | {
      readonly state: "available";
      readonly previous: {
        readonly id: string;
        readonly value: string;
        readonly timelineAt: string;
      };
      readonly delta: {
        readonly value: string;
        readonly direction: "increased" | "decreased" | "unchanged";
      };
    };

/**
 * A bounded, source-first series for one canonical code and one exact unit.
 * `items` are newest first; UI may reverse the sequence for a temporal chart.
 */
export interface IndicatorSeriesResponse {
  readonly contractVersion: typeof INDICATOR_SERIES_CONTRACT_VERSION;
  readonly indicator: {
    readonly canonicalCode: string;
    readonly displayName: string;
    readonly unit: string;
  };
  readonly items: readonly ObservationHistoryItem[];
  readonly comparison: IndicatorComparison;
  readonly nextCursor: string | null;
}

const nullableShortStringSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 200 }, { type: "null" }],
} as const;

const nullableValueStringSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }],
} as const;

const valueStringSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
} as const;

const nullableTimestampSchema = {
  anyOf: [
    {
      type: "string",
      minLength: 20,
      maxLength: 35,
      pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$",
    },
    { type: "null" },
  ],
} as const;

const reviewTextSchema = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  pattern: "^\\S(?:[^\\r\\n]*\\S)?$",
} as const;

export const FACT_REVIEW_COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["factVersion", "decision"],
  properties: {
    factVersion: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    decision: { type: "string", enum: FACT_REVIEW_DECISIONS },
    correction: {
      type: "object",
      additionalProperties: false,
      required: ["sourceName", "sourceValue", "sourceUnit"],
      properties: {
        sourceName: reviewTextSchema,
        sourceValue: { ...reviewTextSchema, maxLength: 100 },
        sourceUnit: { ...reviewTextSchema, maxLength: 100 },
      },
    },
  },
  allOf: [
    {
      if: { properties: { decision: { const: "correct" } }, required: ["decision"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditionals require `then`.
      then: { required: ["correction"] },
      else: { not: { required: ["correction"] } },
    },
  ],
} as const;

export const LAB_EXTRACTION_RESULT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "urn:veylta:schema:lab-extraction:v1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "extractorVersion", "items"],
  properties: {
    schemaVersion: { const: LAB_EXTRACTION_SCHEMA_VERSION },
    extractorVersion: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      pattern: "^[a-z0-9][a-z0-9._/-]*$",
    },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "factKey",
          "sourceName",
          "sourceValue",
          "sourceUnit",
          "proposedCanonicalCode",
          "proposedNormalizedValue",
          "proposedNormalizedUnit",
          "proposedSampledAt",
          "proposedResultedAt",
          "proposedSpecimenType",
          "proposedLaboratory",
          "referenceRange",
          "confidence",
          "validationIssues",
          "source",
        ],
        properties: {
          factKey: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            pattern: "^[a-z0-9][a-z0-9._-]*$",
          },
          sourceName: { type: "string", minLength: 1, maxLength: 200 },
          sourceValue: { type: "string", minLength: 1, maxLength: 120 },
          sourceUnit: valueStringSchema,
          proposedCanonicalCode: {
            anyOf: [
              {
                type: "string",
                minLength: 1,
                maxLength: 120,
                pattern: "^[a-z0-9][a-z0-9._-]*$",
              },
              { type: "null" },
            ],
          },
          proposedNormalizedValue: nullableValueStringSchema,
          proposedNormalizedUnit: nullableValueStringSchema,
          proposedSampledAt: nullableTimestampSchema,
          proposedResultedAt: nullableTimestampSchema,
          proposedSpecimenType: nullableShortStringSchema,
          proposedLaboratory: nullableShortStringSchema,
          referenceRange: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "sourceText",
                  "sourceLow",
                  "sourceHigh",
                  "sourceUnit",
                  "laboratoryOutOfRange",
                ],
                properties: {
                  sourceText: nullableShortStringSchema,
                  sourceLow: nullableValueStringSchema,
                  sourceHigh: nullableValueStringSchema,
                  sourceUnit: nullableValueStringSchema,
                  laboratoryOutOfRange: {
                    anyOf: [{ type: "boolean" }, { type: "null" }],
                  },
                },
              },
              { type: "null" },
            ],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          validationIssues: {
            type: "array",
            maxItems: LAB_FACT_VALIDATION_ISSUES.length,
            uniqueItems: true,
            items: { type: "string", enum: LAB_FACT_VALIDATION_ISSUES },
          },
          source: {
            type: "object",
            additionalProperties: false,
            required: ["pageNumber", "fragment"],
            properties: {
              pageNumber: { type: "integer", minimum: 1, maximum: 1_000 },
              fragment: { type: "string", minLength: 1, maxLength: 2_000 },
            },
          },
        },
      },
    },
  },
} as const;
