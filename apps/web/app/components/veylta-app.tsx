"use client";

import type {
  AdminSetupResponse,
  ArchivedProfileListResponse,
  AssistantId,
  CarePlanCategory,
  CarePlanItem,
  CarePlanItemResponse,
  CarePlanProposalResponse,
  CarePlanResponse,
  CodexExecutionPreference,
  CodexPreferenceUpdateResponse,
  CodexReasoningEffort,
  CodexRuntimeActionResponse,
  CodexServiceTier,
  DocumentDeleteResponse,
  DocumentDetail,
  DocumentDetailResponse,
  DocumentFactsResponse,
  DocumentIntelligenceStructuredResult,
  DocumentProcessingActivityEvent,
  DocumentProcessingResponse,
  DocumentProcessingRestartResponse,
  DocumentProcessingRunDiagnostics,
  DocumentProcessingStatus,
  DocumentSummary,
  DocumentUploadResponse,
  ExtractedFactReviewStatus,
  FactReviewCommand,
  FactReviewResponse,
  FamilyAuditLogResponse,
  FamilyConsentMemberListResponse,
  FamilyInvitationCreateResponse,
  FamilyInvitationRole,
  HealthSummaryComparisonResponse,
  HealthSummaryHistoryResponse,
  HealthSummaryMissingData,
  HealthSummaryRecommendationCode,
  HealthSummaryResponse,
  HomeSettingsResponse,
  IndicatorCatalogResponse,
  IndicatorSeriesResponse,
  LoginResponse,
  ManagedAccountCreateResponse,
  ObservationHistoryResponse,
  PatientProfileSummary,
  ProfileArchiveResponse,
  ProfileConsentGrant,
  ProfileConsentGrantCreateResponse,
  ProfileConsentGrantListResponse,
  ProfileCreateResponse,
  ProfileOverviewDocument,
  ProfileOverviewResponse,
  ProfileOverviewReviewDocument,
  ProfileRestoreResponse,
  SessionFamily,
  SessionResponse,
  SetupStatusResponse,
  StorageRelocationResponse,
} from "@veylta/contracts";
import {
  type DOCUMENT_CATEGORIES,
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  REVIEW_BLOCKING_VALIDATION_ISSUES,
} from "@veylta/contracts";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCheck,
  Clock3,
  ContactRound,
  Files,
  FileText,
  FileUp,
  History,
  House,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { adminSetupError, canOpenSettings, validateAdminSetup } from "../account-access";
import { ApiError, apiPrefix, apiRequest } from "../api-client";
import { assistantIdentity } from "../assistant";
import { takesCheckins } from "../care-plan-checkins";
import { isProcessingActive, isReviewAvailable } from "../document-processing-activity";
import {
  documentResultStatusCopy,
  documentResultTypeCopy,
  prioritizeDocumentResults,
} from "../document-results";
import {
  type ArchiveRow,
  archiveDocumentCountCopy,
  archiveRows,
  archiveValueCountCopy,
  awaitingReviewVerb,
  buildDocumentsArchiveHero,
  bulkConfirmableCount,
  isRestartable,
  restartTargets,
  uploadButtonCopy,
} from "../documents-archive";
import { parseAsk } from "../dossier-ask";
import { formatBytes } from "../format-bytes";
import { formatDate, formatSampleMoment } from "../format-moment";
import {
  documentPath,
  normalizeProfileTab,
  type ProfileTab,
  parseAssistantId,
  profilePath,
  profileTabPath,
} from "../paths";
import { referenceRangeCopy } from "../reference-range-copy";
import { countCopy, pluralForm } from "../russian-plural";
import type { SettingsSection } from "../settings-sections";
import { AssistantHeader } from "./assistant-header";
import { AssistantWorkspace } from "./assistant-workspace";
import { CarePlanCheckins } from "./care-plan-checkins";
import { ClinicianRecordsPanel } from "./clinician-records-panel";
import { DocumentAgentPanel } from "./document-agent-panel";
import { DocumentHero } from "./document-hero";
import { DocumentsHero } from "./documents-hero";
import { DossierPanel } from "./dossier-panel";
import { IdentityChips } from "./identity-chips";
import { ProfileDashboard } from "./profile-dashboard";
import { SettingsGear } from "./settings-gear";
import { SystemStatus } from "./system-status";
import { VeyltaMark } from "./veylta-mark";

const processingPollIntervalMs = 2_000;

type ScreenState =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "authenticated"; session: SessionResponse }
  | { kind: "error" };

async function readSession(): Promise<SessionResponse | null> {
  try {
    return await apiRequest<SessionResponse>("/v1/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

async function readSetupStatus(): Promise<SetupStatusResponse> {
  return apiRequest<SetupStatusResponse>("/v1/setup");
}

function firstProfile(session: SessionResponse): PatientProfileSummary | undefined {
  return session.families.flatMap((family) => family.profiles)[0];
}

function findProfileContext(
  session: SessionResponse,
  familyId: string,
  profileId: string,
): { family: SessionFamily; profile: PatientProfileSummary } | undefined {
  const family = session.families.find((candidate) => candidate.id === familyId);
  const profile = family?.profiles.find((candidate) => candidate.id === profileId);
  return family === undefined || profile === undefined ? undefined : { family, profile };
}

type WorkspaceTab = ProfileTab | "settings";

function documentProcessingPath(
  familyId: string,
  profileId: string,
  documentId: string,
  runId: string | null = null,
): string {
  const base = `/v1${documentPath(familyId, profileId, documentId)}/processing`;
  return runId === null ? base : `${base}?runId=${encodeURIComponent(runId)}`;
}

function documentFactsPath(familyId: string, profileId: string, documentId: string): string {
  return `/v1${documentPath(familyId, profileId, documentId)}/facts`;
}

export function buildDocumentSearchPath(
  familyId: string,
  profileId: string,
  query: string,
): string {
  const params = new URLSearchParams({ q: query.trim() });
  return `/v1${profilePath(familyId, profileId)}/documents?${params.toString()}`;
}

function isDocumentSummary(value: unknown): value is DocumentSummary {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DocumentSummary>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.originalFilename === "string" &&
    typeof candidate.uploadedAt === "string" &&
    typeof candidate.processing === "object" &&
    candidate.processing !== null
  );
}

export function normalizeDocumentSearchResponse(response: unknown): readonly DocumentSummary[] {
  const candidates = Array.isArray(response)
    ? response
    : typeof response === "object" && response !== null
      ? ((response as { documents?: unknown; items?: unknown }).documents ??
        (response as { items?: unknown }).items)
      : null;
  return Array.isArray(candidates) ? candidates.filter(isDocumentSummary) : [];
}

function profileOverviewPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/overview`;
}

function healthSummaryPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/health-summary`;
}

function carePlanPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/care-plan`;
}

function healthSummaryHistoryPath(familyId: string, profileId: string): string {
  return `${healthSummaryPath(familyId, profileId)}/versions`;
}

function healthSummaryComparisonPath(familyId: string, profileId: string): string {
  return `${healthSummaryPath(familyId, profileId)}/compare`;
}

function evidenceBundlePath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/evidence-bundle`;
}

function portableProfileExportPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/portable-export`;
}

function observationHistoryPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/observations`;
}

export function buildIndicatorHistoryPath(
  familyId: string,
  profileId: string,
  canonicalCode: string,
): string {
  const query = new URLSearchParams({ canonicalCode, limit: "5" });
  return `${observationHistoryPath(familyId, profileId)}?${query.toString()}`;
}

export function documentResultMissingFields(result: {
  readonly code: string | null;
  readonly date: string | null;
  readonly lab: string | null;
}): readonly string[] {
  return [
    result.code === null ? "Код показателя" : null,
    result.date === null ? "Дата биоматериала" : null,
    result.lab === null ? "Лаборатория" : null,
  ].filter((value): value is string => value !== null);
}

function indicatorsPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/indicators`;
}

/** The settings page shows the journal a screen at a time; «Показать ещё» walks the cursor. */
const auditLogPageSize = 20;

function familyAuditLogPath(familyId: string): string {
  return `/v1/families/${encodeURIComponent(familyId)}/audit-events`;
}

function familyConsentMembersPath(familyId: string): string {
  return `/v1/families/${encodeURIComponent(familyId)}/members`;
}

function profileConsentGrantsPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/consent-grants`;
}

function archivedProfilesPath(familyId: string): string {
  return `/v1/families/${encodeURIComponent(familyId)}/archived-profiles`;
}

function profileArchivePath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/archive`;
}

function profileRestorePath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/restore`;
}

interface VeyltaAppProps {
  requestedFamilyId?: string;
  requestedProfileId?: string;
  requestedDocumentId?: string;
  /** The assistant view (`/assistants/:assistantId`), optionally pinned to one conversation. */
  requestedAssistantId?: string | undefined;
  requestedConversationId?: string | undefined;
  /** `?ask=<specialty|consilium>`: the dossier asks to open the conversation kept for that addressee. */
  requestedAssistantAsk?: string | undefined;
  requestedTab?: string | undefined;
  /** The profile settings should manage first; set when settings is opened from a profile. */
  requestedSettingsProfileId?: string | undefined;
  requestedCanonicalCode?: string | undefined;
  requestedSettings?: boolean;
  /** Which settings section `/settings[/app]` asked for; the user section by default. */
  requestedSettingsSection?: SettingsSection | undefined;
}

export function VeyltaApp({
  requestedFamilyId,
  requestedProfileId,
  requestedDocumentId,
  requestedAssistantId,
  requestedConversationId,
  requestedAssistantAsk,
  requestedTab,
  requestedCanonicalCode,
  requestedSettings = false,
  requestedSettingsSection = "user",
  requestedSettingsProfileId,
}: VeyltaAppProps) {
  const router = useRouter();
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [action, setAction] = useState<"setup" | "login" | "add-profile" | "logout" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addProfileOpen, setAddProfileOpen] = useState(false);
  const requestedContext =
    requestedFamilyId !== undefined && requestedProfileId !== undefined
      ? { familyId: requestedFamilyId, profileId: requestedProfileId }
      : undefined;
  const hasRequestedProfile = requestedContext !== undefined;

  useEffect(() => {
    let active = true;

    Promise.all([readSession(), readSetupStatus()])
      .then(([session, setup]) => {
        if (!active) return;

        if (session === null) {
          setScreen({ kind: setup.setupRequired ? "setup" : "login" });
          if (hasRequestedProfile) router.replace("/");
          return;
        }

        setScreen({ kind: "authenticated", session });
        const profile = firstProfile(session);
        if (!hasRequestedProfile && !requestedSettings && profile !== undefined) {
          router.replace(profilePath(profile.familyId, profile.id));
        }
        if (hasRequestedProfile && profile === undefined) {
          router.replace("/");
        }
      })
      .catch(() => {
        if (active) setScreen({ kind: "error" });
      });

    return () => {
      active = false;
    };
  }, [hasRequestedProfile, requestedSettings, router]);

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction("setup");
    setActionError(null);

    const form = new FormData(event.currentTarget);
    const fields = {
      username: String(form.get("username") ?? "").trim(),
      displayName: String(form.get("displayName") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      passwordConfirmation: String(form.get("passwordConfirmation") ?? ""),
    };
    const validationError = validateAdminSetup(fields);
    if (validationError !== null) {
      setActionError(validationError);
      setAction(null);
      return;
    }
    try {
      const setup = await apiRequest<AdminSetupResponse>("/v1/setup", {
        method: "POST",
        body: JSON.stringify({
          username: fields.username,
          displayName: fields.displayName,
          password: fields.password,
        }),
      });
      const session = await readSession();
      if (session === null) throw new Error("Session was not created");
      setScreen({ kind: "authenticated", session });
      router.replace(profilePath(setup.family.id, setup.profile.id));
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? adminSetupError(error.status, error.code)
          : "Не удалось связаться с сервером. Проверьте, что API запущен, и повторите попытку.",
      );
    } finally {
      setAction(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction("login");
    setActionError(null);

    const form = new FormData(event.currentTarget);
    try {
      await apiRequest<LoginResponse>("/v1/session", {
        method: "POST",
        body: JSON.stringify({
          username: String(form.get("username") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }),
      });
      const session = await readSession();
      if (session === null) throw new Error("Session was not created");
      setScreen({ kind: "authenticated", session });
      const profile = firstProfile(session);
      if (!requestedSettings) {
        router.replace(profile === undefined ? "/" : profilePath(profile.familyId, profile.id));
      }
    } catch {
      setActionError("Неверный логин или пароль.");
    } finally {
      setAction(null);
    }
  }

  async function handleAddProfile(event: FormEvent<HTMLFormElement>, family: SessionFamily) {
    event.preventDefault();
    setAction("add-profile");
    setActionError(null);

    const form = new FormData(event.currentTarget);
    try {
      const created = await apiRequest<ProfileCreateResponse>(
        `/v1/families/${encodeURIComponent(family.id)}/profiles`,
        {
          method: "POST",
          body: JSON.stringify({
            displayName: String(form.get("profileName") ?? "").trim(),
            kind: "dependent",
          }),
        },
      );
      const session = await readSession();
      if (session === null) throw new Error("Session expired");
      setScreen({ kind: "authenticated", session });
      setAddProfileOpen(false);
      router.push(profilePath(created.profile.familyId, created.profile.id));
    } catch {
      setActionError("Не удалось добавить профиль. Проверьте имя и попробуйте ещё раз.");
    } finally {
      setAction(null);
    }
  }

  async function handleLogout() {
    setAction("logout");
    setActionError(null);
    try {
      await apiRequest<void>("/v1/session", { method: "DELETE" });
      setScreen({ kind: "loading" });
      setAddProfileOpen(false);
      router.replace("/");
    } catch {
      setAddProfileOpen(false);
      setActionError("Не удалось завершить сессию. Попробуйте ещё раз.");
    } finally {
      setAction(null);
    }
  }

  async function refreshSessionAfterProfileArchive(): Promise<void> {
    const refreshed = await readSession();
    if (refreshed === null) {
      setScreen({ kind: "login" });
      router.replace("/");
      return;
    }
    setScreen({ kind: "authenticated", session: refreshed });
    const fallback = firstProfile(refreshed);
    router.replace(fallback === undefined ? "/" : profilePath(fallback.familyId, fallback.id));
  }

  async function refreshSessionAfterProfileRestore(): Promise<void> {
    const refreshed = await readSession();
    if (refreshed === null) {
      setScreen({ kind: "login" });
      router.replace("/");
      return;
    }
    setScreen({ kind: "authenticated", session: refreshed });
  }

  async function refreshSession(): Promise<void> {
    const refreshed = await readSession();
    if (refreshed === null) {
      setScreen({ kind: "login" });
      router.replace("/");
      return;
    }
    setScreen({ kind: "authenticated", session: refreshed });
  }

  const session = screen.kind === "authenticated" ? screen.session : undefined;
  const context =
    session !== undefined && requestedContext !== undefined
      ? findProfileContext(session, requestedContext.familyId, requestedContext.profileId)
      : undefined;
  const redirectProfile = session === undefined ? undefined : firstProfile(session);
  const navigationProfile = context?.profile ?? redirectProfile;
  const activeTab: WorkspaceTab = requestedSettings
    ? "settings"
    : requestedDocumentId !== undefined
      ? "documents"
      : requestedAssistantId !== undefined
        ? "overview"
        : normalizeProfileTab(requestedTab);
  const pageTitle = requestedSettings
    ? "Настройки — Veylta"
    : context === undefined
      ? "Veylta"
      : `${context.profile.displayName} — Veylta`;

  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]'),
    );
    const current = tabs.indexOf(document.activeElement as HTMLAnchorElement);
    if (current < 0 || tabs.length === 0) return;

    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Перейти к содержанию
      </a>
      <header
        className={
          navigationProfile === undefined ? "workspace-bar" : "workspace-bar workspace-bar--profile"
        }
      >
        <Link className="wordmark" href="/" aria-label="Veylta — главная">
          <VeyltaMark className="wordmark__mark" />
          Veylta
        </Link>
        {navigationProfile !== undefined ? (
          <div
            className="workspace-primary-nav"
            aria-label="Основные разделы профиля"
            role="tablist"
            onKeyDown={handleTabKeyDown}
          >
            <Link
              id="workspace-tab-overview"
              className={`workspace-primary-nav__item ${activeTab === "overview" ? "workspace-primary-nav__item--active" : ""}`}
              href={profileTabPath(navigationProfile.familyId, navigationProfile.id, "overview")}
              role="tab"
              aria-selected={activeTab === "overview"}
              aria-controls="workspace-panel-overview"
              tabIndex={activeTab === "overview" ? 0 : -1}
            >
              <House size={17} aria-hidden="true" />
              Обзор
            </Link>
            <Link
              id="workspace-tab-documents"
              className={`workspace-primary-nav__item ${activeTab === "documents" ? "workspace-primary-nav__item--active" : ""}`}
              href={profileTabPath(navigationProfile.familyId, navigationProfile.id, "documents")}
              role="tab"
              aria-selected={activeTab === "documents"}
              aria-controls="workspace-panel-documents"
              tabIndex={activeTab === "documents" ? 0 : -1}
            >
              <Files size={17} aria-hidden="true" />
              Документы
            </Link>
            <Link
              id="workspace-tab-history"
              className={`workspace-primary-nav__item ${activeTab === "history" ? "workspace-primary-nav__item--active" : ""}`}
              href={profileTabPath(navigationProfile.familyId, navigationProfile.id, "history")}
              role="tab"
              aria-selected={activeTab === "history"}
              aria-controls="workspace-panel-history"
              tabIndex={activeTab === "history" ? 0 : -1}
            >
              <History size={17} aria-hidden="true" />
              История
            </Link>
            <Link
              id="workspace-tab-dossier"
              className={`workspace-primary-nav__item ${activeTab === "dossier" ? "workspace-primary-nav__item--active" : ""}`}
              href={profileTabPath(navigationProfile.familyId, navigationProfile.id, "dossier")}
              role="tab"
              aria-selected={activeTab === "dossier"}
              aria-controls="workspace-panel-dossier"
              tabIndex={activeTab === "dossier" ? 0 : -1}
            >
              <ContactRound size={17} aria-hidden="true" />
              Досье
            </Link>
          </div>
        ) : null}
        {navigationProfile !== undefined ? (
          <Link
            className="workspace-search"
            href={`${profileTabPath(navigationProfile.familyId, navigationProfile.id, "history")}#indicator-catalog`}
            aria-label="Поиск по архиву"
          >
            <Search size={18} aria-hidden="true" />
            <span>Поиск по архиву</span>
          </Link>
        ) : null}
        <div className="workspace-actions">
          {session === undefined ? (
            <span className="environment">
              <span aria-hidden="true" />
              Домашний сервер
            </span>
          ) : (
            <SettingsGear session={session} profileId={navigationProfile?.id} />
          )}
          {session !== undefined ? (
            <span className="workspace-identity">
              <span aria-hidden="true">{session.user.displayName.slice(0, 2).toUpperCase()}</span>
              <span>
                <strong>{session.user.displayName}</strong>
                <small>
                  {session.user.role === "admin" ? "Администратор системы" : "Пользователь системы"}
                </small>
              </span>
            </span>
          ) : null}
          {session !== undefined ? (
            <button
              className="workspace-icon-action"
              type="button"
              onClick={handleLogout}
              disabled={action === "logout"}
              aria-label={action === "logout" ? "Выходим…" : "Выйти"}
              title={action === "logout" ? "Выходим…" : "Выйти"}
            >
              <LogOut size={19} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <main id="main-content">
        {screen.kind === "loading" ? <LoadingScreen /> : null}
        {screen.kind === "error" ? <ErrorScreen onRetry={() => window.location.reload()} /> : null}
        {(screen.kind === "setup" || screen.kind === "login") && !hasRequestedProfile ? (
          <AccountAccessScreen
            mode={screen.kind}
            error={actionError}
            pending={action === screen.kind}
            onSubmit={screen.kind === "setup" ? handleSetup : handleLogin}
          />
        ) : null}
        {(screen.kind === "setup" || screen.kind === "login") && hasRequestedProfile ? (
          <LoadingScreen copy="Возвращаем к началу…" />
        ) : null}
        {session !== undefined && requestedSettings ? (
          <HomeSettingsScreen
            session={session}
            onSessionRefresh={refreshSession}
            initialProfileId={requestedSettingsProfileId}
            section={requestedSettingsSection}
            profileManagement={{
              addProfileOpen,
              action,
              error: actionError,
              onAddProfileToggle: () => {
                setActionError(null);
                setAddProfileOpen((open) => !open);
              },
              onAddProfile: handleAddProfile,
              onProfileArchived: refreshSessionAfterProfileArchive,
              onProfileRestored: refreshSessionAfterProfileRestore,
            }}
          />
        ) : null}
        {session !== undefined &&
        !requestedSettings &&
        !hasRequestedProfile &&
        redirectProfile !== undefined ? (
          <LoadingScreen copy="Открываем профиль…" />
        ) : null}
        {session !== undefined &&
        !requestedSettings &&
        !hasRequestedProfile &&
        redirectProfile === undefined ? (
          <NoAuthorizedProfilesScreen />
        ) : null}
        {session !== undefined &&
        !requestedSettings &&
        hasRequestedProfile &&
        context === undefined ? (
          <MissingProfileScreen fallbackProfile={redirectProfile} />
        ) : null}
        {session !== undefined && !requestedSettings && context !== undefined ? (
          <ProfileWorkspace
            session={session}
            family={context.family}
            profile={context.profile}
            requestedDocumentId={requestedDocumentId}
            requestedAssistantId={parseAssistantId(requestedAssistantId)}
            requestedConversationId={requestedConversationId}
            requestedAssistantAsk={requestedAssistantAsk}
            activeTab={activeTab === "settings" ? "overview" : activeTab}
            requestedCanonicalCode={requestedCanonicalCode}
            error={actionError}
            onProfileChange={(familyId, profileId) => {
              setActionError(null);
              router.push(profilePath(familyId, profileId));
            }}
          />
        ) : null}
      </main>
    </>
  );
}

interface ProfileManagementProps {
  addProfileOpen: boolean;
  action: "setup" | "login" | "add-profile" | "logout" | null;
  error: string | null;
  onAddProfileToggle: () => void;
  onAddProfile: (event: FormEvent<HTMLFormElement>, family: SessionFamily) => void;
  onProfileArchived: () => Promise<void>;
  onProfileRestored: () => Promise<void>;
}

interface HomeSettingsScreenProps {
  session: SessionResponse;
  onSessionRefresh: () => Promise<void>;
  initialProfileId?: string | undefined;
  section: SettingsSection;
  profileManagement: ProfileManagementProps;
}

function HomeSettingsScreen({
  session,
  onSessionRefresh,
  initialProfileId,
  section,
  profileManagement,
}: HomeSettingsScreenProps) {
  const settingsLoadGeneration = useRef(0);
  const [settings, setSettings] = useState<HomeSettingsResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [pending, setPending] = useState<"account" | "storage" | "codex" | "preference" | null>(
    null,
  );
  const [accountError, setAccountError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftPreference, setDraftPreference] = useState<CodexExecutionPreference>({
    modelId: "",
    documentModelId: null,
    reasoningEffort: "medium",
    documentReasoningEffort: "low",
    assistantReasoningEffort: "high",
    serviceTier: "standard",
  });
  const {
    modelId,
    documentModelId,
    reasoningEffort,
    documentReasoningEffort,
    assistantReasoningEffort,
    serviceTier,
  } = draftPreference;

  const load = useCallback(async () => {
    const generation = ++settingsLoadGeneration.current;
    setLoadState("loading");
    try {
      const loaded = await apiRequest<HomeSettingsResponse>("/v1/settings");
      if (generation !== settingsLoadGeneration.current) return;
      setSettings(loaded);
      setDraftPreference(loaded.codex.preference);
      setLoadState("ready");
    } catch (error) {
      if (generation !== settingsLoadGeneration.current) return;
      setLoadState(error instanceof ApiError && error.status === 404 ? "denied" : "error");
    }
  }, []);

  useEffect(() => {
    // Only an administrator may read server settings; a family owner never asks.
    if (session.user.role === "admin") void load();
  }, [load, session.user.role]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("account");
    setAccountError(null);
    setNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("passwordConfirmation") ?? "")) {
      setAccountError("Пароли не совпадают.");
      setPending(null);
      return;
    }
    try {
      const created = await apiRequest<ManagedAccountCreateResponse>("/v1/settings/accounts", {
        method: "POST",
        body: JSON.stringify({
          username: String(form.get("username") ?? "").trim(),
          displayName: String(form.get("displayName") ?? "").trim(),
          role: String(form.get("role") ?? "user"),
          password,
        }),
      });
      formElement.reset();
      setSettings((current) =>
        current === null
          ? current
          : { ...current, accounts: [...current.accounts, created.account] },
      );
      await onSessionRefresh();
      setNotice(`Учётная запись ${created.account.username} создана вместе с личной карточкой.`);
    } catch (error) {
      setAccountError(
        error instanceof ApiError && error.status === 409
          ? "Такой логин уже занят."
          : "Не удалось создать учётную запись. Проверьте поля и повторите.",
      );
    } finally {
      setPending(null);
    }
  }

  async function relocateStorage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("storage");
    setStorageError(null);
    setNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const relocated = await apiRequest<StorageRelocationResponse>(
        "/v1/settings/storage/relocate",
        {
          method: "POST",
          body: JSON.stringify({ rootPath: String(form.get("rootPath") ?? "").trim() }),
        },
      );
      setSettings((current) =>
        current === null ? current : { ...current, storage: relocated.storage },
      );
      formElement.reset();
      setNotice("Хранилище проверено и переключено. Прежняя копия сохранена для восстановления.");
    } catch (error) {
      setStorageError(
        error instanceof ApiError && error.status === 422
          ? "Укажите абсолютный путь внутри отдельной папки, не домашний каталог и не корень диска."
          : "Перенос не завершён. Активная точка хранения не изменилась.",
      );
    } finally {
      setPending(null);
    }
  }

  async function startCodex() {
    setPending("codex");
    setCodexError(null);
    setNotice(null);
    try {
      const started = await apiRequest<CodexRuntimeActionResponse>("/v1/settings/codex/start", {
        method: "POST",
      });
      setSettings((current) => (current === null ? current : { ...current, codex: started.codex }));
      setDraftPreference(started.codex.preference);
      if (started.codex.daemonRunning) {
        setNotice("Codex runtime запущен и готов принимать локальные задания.");
      } else {
        setCodexError(
          "Runtime не запустился. Проверьте установку и выполните codex login в терминале.",
        );
      }
    } catch {
      setCodexError("Не удалось запустить Codex runtime. Данные Veylta не изменились.");
    } finally {
      setPending(null);
    }
  }

  async function saveCodexPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const preference = {
      modelId: String(form.get("modelId") ?? ""),
      reasoningEffort: String(form.get("reasoningEffort") ?? "") as CodexReasoningEffort,
      documentReasoningEffort: String(
        form.get("documentReasoningEffort") ?? "",
      ) as CodexReasoningEffort,
      assistantReasoningEffort: String(
        form.get("assistantReasoningEffort") ?? "",
      ) as CodexReasoningEffort,
      documentModelId: (() => {
        const value = String(form.get("documentModelId") ?? "");
        return value === "" ? null : value;
      })(),
      serviceTier: String(form.get("serviceTier") ?? "") as CodexServiceTier,
    };
    setPending("preference");
    setCodexError(null);
    setNotice(null);
    try {
      const updated = await apiRequest<CodexPreferenceUpdateResponse>(
        "/v1/settings/codex/preferences",
        {
          method: "PUT",
          body: JSON.stringify(preference),
        },
      );
      setSettings((current) => (current === null ? current : { ...current, codex: updated.codex }));
      setDraftPreference(updated.codex.preference);
      setNotice("Профиль Codex сохранён. Новые задания будут использовать эти параметры.");
    } catch (error) {
      setCodexError(
        error instanceof ApiError && error.code === "CODEX_CATALOG_UNAVAILABLE"
          ? "Codex не сообщил список моделей. Проверьте вход через ChatGPT и повторите."
          : "Этот профиль недоступен в установленном Codex. Обновите список и выберите другой.",
      );
    } finally {
      setPending(null);
    }
  }

  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    if (!canOpenSettings(session)) return <MissingSettingsScreen />;
    return (
      <section
        id="workspace-panel-settings"
        className="settings-shell workspace-tab-panel workspace-tab-panel--settings"
        role="tabpanel"
        aria-labelledby="workspace-tab-settings settings-title"
        aria-label="Настройки"
      >
        <div className="settings-heading">
          <div>
            <p className="context-line">Семья</p>
            <h1 id="settings-title">Настройки</h1>
            <p className="lede">
              Профили семьи, архив и доступ участников. Серверные настройки — Codex, хранилище,
              учётные записи — доступны только администратору.
            </p>
          </div>
        </div>
        <ProfileManagementSettings
          session={session}
          initialProfileId={initialProfileId}
          {...profileManagement}
        />
      </section>
    );
  }
  if (loadState === "loading") return <LoadingScreen copy="Проверяем домашний сервер…" />;
  if (loadState === "denied") return <MissingSettingsScreen />;
  if (loadState === "error" || settings === null) {
    return <ErrorScreen onRetry={() => void load()} />;
  }

  const codexState = !settings.codex.installed
    ? "CLI не установлен"
    : !settings.codex.authenticated
      ? "Требуется вход"
      : settings.codex.daemonRunning
        ? "Агент готов"
        : "Готов к запуску";
  const subscriptionConnected =
    settings.codex.authenticated && settings.codex.authenticationMode === "chatgpt";
  const selectedModel =
    settings.codex.models.find((model) => model.id === modelId) ?? settings.codex.models[0];
  const selectedDocumentModel =
    documentModelId === null
      ? selectedModel
      : (settings.codex.models.find((model) => model.id === documentModelId) ?? selectedModel);
  const reasoningLabels: Record<CodexReasoningEffort, string> = {
    low: "Низкий",
    medium: "Средний",
    high: "Высокий",
    xhigh: "Очень высокий",
    max: "Максимальный",
    ultra: "Ультра",
  };

  return (
    <section
      id="workspace-panel-settings"
      className="settings-shell workspace-tab-panel workspace-tab-panel--settings"
      role="tabpanel"
      aria-labelledby="workspace-tab-settings settings-title"
      aria-label="Настройки"
    >
      <div className="settings-heading">
        <div>
          <p className="context-line">Управление домашним контуром</p>
          <h1 id="settings-title">Настройки сервера</h1>
          <p className="lede">
            Здесь администратор управляет локальным агентом, местом хранения и доступом людей.
            Оригиналы остаются в выбранном домашнем хранилище. Только подтверждённая выжимка
            отправляется в Codex после отдельного согласия владельца.
          </p>
        </div>
        <div className="settings-heading__identity">
          <span>Администратор</span>
          <strong>{session.user.displayName}</strong>
          <small>@{session.user.username}</small>
        </div>
      </div>

      {notice !== null ? (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="settings-console">
        <section className="codex-console" aria-labelledby="codex-settings-title">
          <div className="codex-console__topline">
            <span
              className={`status-dot ${settings.codex.daemonRunning ? "status-dot--ready" : ""}`}
            />
            <span>{codexState}</span>
            <span className="codex-console__mode">
              {subscriptionConnected ? "ChatGPT подписка" : "Локальный Codex"}
            </span>
          </div>
          <div className="codex-console__body">
            <div>
              <p className="section-label">Codex runtime</p>
              <h2 id="codex-settings-title">Локальный агент без API-ключа</h2>
              <p className="codex-console__copy">
                Veylta запускает узкие задания через установленный Codex CLI, а app-server daemon
                показывает готовность runtime. Авторизацией владеет сам Codex; приложение не читает
                и не копирует OAuth-токены.
              </p>
            </div>
            <dl className="runtime-facts">
              <div>
                <dt>CLI</dt>
                <dd>{settings.codex.cliVersion ?? "Не найден"}</dd>
              </div>
              <div>
                <dt>Авторизация</dt>
                <dd>
                  {subscriptionConnected
                    ? "ChatGPT / Codex"
                    : settings.codex.authenticated
                      ? "Другой режим"
                      : "Не выполнена"}
                </dd>
              </div>
              <div>
                <dt>Профиль</dt>
                <dd>
                  {selectedModel?.displayName ?? settings.codex.preference.modelId} ·{" "}
                  {reasoningLabels[settings.codex.preference.reasoningEffort]} · разбор:{" "}
                  {settings.codex.preference.documentModelId === null
                    ? ""
                    : `${
                        settings.codex.models.find(
                          (model) => model.id === settings.codex.preference.documentModelId,
                        )?.displayName ?? settings.codex.preference.documentModelId
                      } · `}
                  {reasoningLabels[settings.codex.preference.documentReasoningEffort]} · ассистенты:{" "}
                  {reasoningLabels[settings.codex.preference.assistantReasoningEffort]}
                </dd>
              </div>
            </dl>
          </div>
          {settings.codex.models.length > 0 ? (
            <form
              className="codex-profile"
              onSubmit={saveCodexPreference}
              aria-busy={pending === "preference"}
            >
              <div className="codex-profile__fields">
                <label className="field">
                  <span>Модель</span>
                  <select
                    name="modelId"
                    value={modelId}
                    disabled={pending !== null}
                    onChange={(event) => {
                      const nextModel = settings.codex.models.find(
                        (model) => model.id === event.currentTarget.value,
                      );
                      if (nextModel === undefined) return;
                      setDraftPreference((current) => {
                        // The document effort follows the document model, which may differ.
                        const documentModel =
                          current.documentModelId === null
                            ? nextModel
                            : (settings.codex.models.find(
                                (model) => model.id === current.documentModelId,
                              ) ?? nextModel);
                        return {
                          modelId: nextModel.id,
                          documentModelId: current.documentModelId,
                          reasoningEffort: nextModel.supportedReasoningEfforts.includes(
                            current.reasoningEffort,
                          )
                            ? current.reasoningEffort
                            : nextModel.defaultReasoningEffort,
                          documentReasoningEffort: documentModel.supportedReasoningEfforts.includes(
                            current.documentReasoningEffort,
                          )
                            ? current.documentReasoningEffort
                            : "low",
                          assistantReasoningEffort: nextModel.supportedReasoningEfforts.includes(
                            current.assistantReasoningEffort,
                          )
                            ? current.assistantReasoningEffort
                            : "high",
                          serviceTier: nextModel.supportsFastMode
                            ? current.serviceTier
                            : "standard",
                        };
                      });
                    }}
                  >
                    {settings.codex.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                        {model.isDefault ? " · рекомендуется" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Рассуждения в диалогах и плане</span>
                  <select
                    name="reasoningEffort"
                    value={reasoningEffort}
                    disabled={pending !== null}
                    onChange={(event) => {
                      const value = event.currentTarget.value as CodexReasoningEffort;
                      setDraftPreference((current) => ({
                        ...current,
                        reasoningEffort: value,
                      }));
                    }}
                  >
                    {(selectedModel?.supportedReasoningEfforts ?? []).map((effort) => (
                      <option key={effort} value={effort}>
                        {reasoningLabels[effort]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Рассуждения ассистентов</span>
                  <select
                    name="assistantReasoningEffort"
                    value={assistantReasoningEffort}
                    disabled={pending !== null}
                    onChange={(event) => {
                      const value = event.currentTarget.value as CodexReasoningEffort;
                      setDraftPreference((current) => ({
                        ...current,
                        assistantReasoningEffort: value,
                      }));
                    }}
                  >
                    {(selectedModel?.supportedReasoningEfforts ?? []).map((effort) => (
                      <option key={effort} value={effort}>
                        {reasoningLabels[effort]}
                      </option>
                    ))}
                  </select>
                  <small>
                    ИИ-врач и его проверяющий запуск: второе мнение — это рассуждение над
                    доказательствами, поэтому по умолчанию высокий уровень.
                  </small>
                </label>
                <label className="field">
                  <span>Модель для разбора документов</span>
                  <select
                    name="documentModelId"
                    value={documentModelId ?? ""}
                    disabled={pending !== null}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      const nextModel =
                        value === ""
                          ? selectedModel
                          : settings.codex.models.find((model) => model.id === value);
                      setDraftPreference((current) => ({
                        ...current,
                        documentModelId: value === "" ? null : value,
                        documentReasoningEffort: nextModel?.supportedReasoningEfforts.includes(
                          current.documentReasoningEffort,
                        )
                          ? current.documentReasoningEffort
                          : "low",
                      }));
                    }}
                  >
                    <option value="">Та же, что для диалогов</option>
                    {settings.codex.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                  </select>
                  <small>
                    У отдельной модели — свой лимит использования: разбор не расходует квоту
                    диалогов.
                  </small>
                </label>
                <label className="field">
                  <span>Рассуждения при разборе документов</span>
                  <select
                    name="documentReasoningEffort"
                    value={documentReasoningEffort}
                    disabled={pending !== null}
                    onChange={(event) => {
                      const value = event.currentTarget.value as CodexReasoningEffort;
                      setDraftPreference((current) => ({
                        ...current,
                        documentReasoningEffort: value,
                      }));
                    }}
                  >
                    {(selectedDocumentModel?.supportedReasoningEfforts ?? []).map((effort) => (
                      <option key={effort} value={effort}>
                        {reasoningLabels[effort]}
                      </option>
                    ))}
                  </select>
                  <small>
                    Разбор — это переписывание под строгую схему: коды берутся из каталога,
                    диапазоны считает Veylta. Низкий уровень в несколько раз быстрее.
                  </small>
                </label>
              </div>
              <fieldset className="codex-speed">
                <legend>Режим выполнения</legend>
                <label data-active={serviceTier === "standard"}>
                  <input
                    type="radio"
                    name="serviceTier"
                    value="standard"
                    checked={serviceTier === "standard"}
                    disabled={pending !== null}
                    onChange={() =>
                      setDraftPreference((current) => ({ ...current, serviceTier: "standard" }))
                    }
                  />
                  <span>
                    <strong>Стандартный</strong>
                    <small>Обычный расход лимита</small>
                  </span>
                </label>
                <label
                  data-active={serviceTier === "fast"}
                  data-disabled={!selectedModel?.supportsFastMode}
                >
                  <input
                    type="radio"
                    name="serviceTier"
                    value="fast"
                    checked={serviceTier === "fast"}
                    disabled={pending !== null || !selectedModel?.supportsFastMode}
                    onChange={() =>
                      setDraftPreference((current) => ({ ...current, serviceTier: "fast" }))
                    }
                  />
                  <span>
                    <strong>Fast · 1,5× быстрее</strong>
                    <small>
                      {selectedModel?.supportsFastMode
                        ? "Расходует лимит подписки быстрее"
                        : "Недоступен для этой модели"}
                    </small>
                  </span>
                </label>
              </fieldset>
              <output className="codex-profile__preview" aria-live="polite">
                Новые задания: {selectedModel?.displayName ?? modelId} ·{" "}
                {reasoningLabels[reasoningEffort]} ·{" "}
                {serviceTier === "fast" ? "Fast" : "Стандартный"}
              </output>
              {selectedModel?.upgradeModelId === null || selectedModel === undefined ? null : (
                <p className="codex-profile__upgrade">
                  Codex рекомендует перейти на {selectedModel.upgradeModelId}.
                </p>
              )}
              <button
                className="button button--secondary codex-profile__save"
                type="submit"
                disabled={
                  pending !== null ||
                  (modelId === settings.codex.preference.modelId &&
                    reasoningEffort === settings.codex.preference.reasoningEffort &&
                    serviceTier === settings.codex.preference.serviceTier)
                }
              >
                {pending === "preference" ? "Сохраняем…" : "Сохранить профиль"}
              </button>
            </form>
          ) : settings.codex.authenticated ? (
            <p className="codex-console__instruction">
              Codex не сообщил доступные модели. Обновите CLI или проверьте вход через ChatGPT.
            </p>
          ) : null}
          <section className="codex-usage" aria-labelledby="codex-usage-title">
            <div className="codex-usage__heading">
              <h3 id="codex-usage-title">Лимиты подписки</h3>
              <span>Данные Codex</span>
            </div>
            {settings.codex.usageLimits.length === 0 ? (
              <p>Codex не сообщил текущий лимит.</p>
            ) : (
              <ul>
                {settings.codex.usageLimits.map((limit) => (
                  <li key={`${limit.name}-${limit.resetsAt}`}>
                    <div className="codex-usage__line">
                      <strong>{limit.name}</strong>
                      <span>Осталось {limit.remainingPercent}%</span>
                    </div>
                    <progress
                      max={100}
                      value={limit.usedPercent}
                      aria-label={`${limit.name}: использовано ${limit.usedPercent}%`}
                    />
                    <small>
                      Обновится{" "}
                      {new Intl.DateTimeFormat("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(limit.resetsAt))}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!settings.codex.installed ? (
            <p className="codex-console__instruction">
              Установите CLI на домашнем сервере: <code>npm install -g @openai/codex</code>
            </p>
          ) : !settings.codex.authenticated ? (
            <p className="codex-console__instruction">
              В терминале выполните <code>codex login</code> и войдите через ChatGPT.
            </p>
          ) : !settings.codex.daemonRunning ? (
            <button
              className="button codex-console__action"
              type="button"
              onClick={startCodex}
              disabled={pending !== null}
            >
              {pending === "codex" ? "Запускаем…" : "Запустить Codex runtime"}
            </button>
          ) : (
            <p className="codex-console__instruction codex-console__instruction--ready">
              Агент подключён. Он получает только явно поставленные Veylta задания.
            </p>
          )}
          {codexError !== null ? (
            <p className="form-error" role="alert">
              {codexError}
            </p>
          ) : null}
          <p className="codex-console__footnote">
            Экспериментальный адаптер · расходуются лимиты вашей подписки Codex, отдельной оплаты за
            API-токены нет.
          </p>
        </section>

        <section className="storage-settings" aria-labelledby="storage-settings-title">
          <div className="settings-section-heading">
            <div>
              <p className="section-label">Локальные данные</p>
              <h2 id="storage-settings-title">Точка хранения</h2>
            </div>
            <span className="storage-generation">Поколение {settings.storage.generation}</span>
          </div>
          <dl className="storage-current">
            <div>
              <dt>Драйвер</dt>
              <dd>{settings.storage.driver === "local" ? "Локальная папка" : "S3-совместимый"}</dd>
            </div>
            <div>
              <dt>Активный путь</dt>
              <dd>
                <code>{settings.storage.rootPath ?? "Настраивается вне интерфейса"}</code>
              </dd>
            </div>
          </dl>
          {settings.storage.relocationSupported ? (
            <form
              className="storage-relocation"
              onSubmit={relocateStorage}
              aria-busy={pending === "storage"}
            >
              <label className="field">
                <span>Новая папка</span>
                <input
                  name="rootPath"
                  type="text"
                  required
                  minLength={2}
                  maxLength={2048}
                  placeholder="/Volumes/Health/Veylta"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={pending !== null}
                />
              </label>
              <label className="confirmation-field">
                <input name="confirmed" type="checkbox" required disabled={pending !== null} />
                <span>
                  Скопировать и проверить все объекты перед переключением. Старую папку не удалять.
                </span>
              </label>
              <button
                className="button button--secondary"
                type="submit"
                disabled={pending !== null}
              >
                {pending === "storage" ? "Проверяем копию…" : "Перенести хранилище"}
              </button>
              {storageError !== null ? (
                <p className="form-error" role="alert">
                  {storageError}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="form-note">
              Для этого драйвера перенос выполняется в конфигурации сервера.
            </p>
          )}
        </section>
      </div>

      <ProfileManagementSettings
        session={session}
        initialProfileId={initialProfileId}
        {...profileManagement}
      />

      <section className="account-settings" aria-labelledby="account-settings-title">
        <div className="settings-section-heading account-settings__heading">
          <div>
            <p className="section-label">Доступ к сервису</p>
            <h2 id="account-settings-title">Учётные записи</h2>
          </div>
          <p>{settings.accounts.length} на домашнем сервере</p>
        </div>
        <div className="account-settings__body">
          <ul className="account-register" aria-label="Учётные записи">
            {settings.accounts.map((account) => (
              <li className="account-register__row" key={account.id}>
                <span className="account-avatar" aria-hidden="true">
                  {account.displayName.slice(0, 1).toLocaleUpperCase("ru")}
                </span>
                <span className="account-register__identity">
                  <strong>{account.displayName}</strong>
                  <small>@{account.username}</small>
                </span>
                <span className="account-register__role">
                  {account.role === "admin" ? "Администратор" : "Пользователь"}
                </span>
                <span
                  className={`account-register__status account-register__status--${account.status}`}
                >
                  {account.status === "active" ? "Активна" : "Отключена"}
                </span>
              </li>
            ))}
          </ul>

          <form
            className="account-create"
            onSubmit={createAccount}
            aria-busy={pending === "account"}
          >
            <div className="form-heading">
              <p>Новый доступ</p>
              <h3>Создать учётную запись</h3>
            </div>
            <label className="field">
              <span>Имя человека</span>
              <input
                name="displayName"
                type="text"
                required
                minLength={1}
                maxLength={120}
                autoComplete="off"
                disabled={pending !== null}
              />
            </label>
            <label className="field">
              <span>Логин</span>
              <input
                name="username"
                type="text"
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                disabled={pending !== null}
              />
            </label>
            <label className="field">
              <span>Роль</span>
              <select name="role" defaultValue="user" disabled={pending !== null}>
                <option value="user">Пользователь</option>
                <option value="admin">Администратор</option>
              </select>
            </label>
            <label className="field">
              <span>Временный пароль</span>
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                disabled={pending !== null}
              />
            </label>
            <label className="field">
              <span>Повторите временный пароль</span>
              <input
                name="passwordConfirmation"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                disabled={pending !== null}
              />
            </label>
            <p className="form-note">
              Вместе с учёткой создаётся личная взрослая карточка. Роль определяет системные права,
              доступ к чужим карточкам проверяется отдельно.
            </p>
            {accountError !== null ? (
              <p className="form-error" role="alert">
                {accountError}
              </p>
            ) : null}
            <button className="button button--primary" type="submit" disabled={pending !== null}>
              {pending === "account" ? "Создаём…" : "Создать учётную запись"}
            </button>
          </form>
        </div>
      </section>
    </section>
  );
}

/**
 * Family profiles and access are administration, not documents, so they live in settings.
 * The rail is reused as-is; only the profile it acts on is chosen here.
 */
function ProfileManagementSettings({
  session,
  initialProfileId,
  addProfileOpen,
  action,
  error,
  onAddProfileToggle,
  onAddProfile,
  onProfileArchived,
  onProfileRestored,
}: { session: SessionResponse; initialProfileId?: string | undefined } & ProfileManagementProps) {
  const profiles = session.families.flatMap((family) =>
    family.profiles.map((profile) => ({ family, profile })),
  );
  // Opened from a profile, settings manages that profile first; otherwise the first one.
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    profiles.find((entry) => entry.profile.id === initialProfileId)?.profile.id ??
      profiles[0]?.profile.id ??
      null,
  );
  const selected =
    profiles.find((entry) => entry.profile.id === selectedProfileId) ?? profiles[0] ?? null;
  if (selected === null || selected.family.role !== "owner") return null;

  return (
    <section
      className="profile-settings"
      aria-labelledby="profile-settings-title"
      data-testid="profile-settings"
    >
      <div className="settings-section-heading">
        <div>
          <p className="section-label">Семья</p>
          <h2 id="profile-settings-title">Профили и доступ</h2>
        </div>
        {profiles.length > 1 ? (
          <label className="profile-switcher">
            <span className="visually-hidden">Профиль для управления</span>
            <select
              aria-label="Профиль для управления"
              value={selected.profile.id}
              onChange={(event) => setSelectedProfileId(event.target.value)}
            >
              {profiles.map((entry) => (
                <option key={entry.profile.id} value={entry.profile.id}>
                  {entry.profile.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <ProfileManagementRail
        key={selected.profile.id}
        family={selected.family}
        profile={selected.profile}
        ownerCanAddProfile
        addProfileOpen={addProfileOpen}
        action={action}
        error={error}
        onAddProfileToggle={onAddProfileToggle}
        onAddProfile={onAddProfile}
        onProfileArchived={onProfileArchived}
        onProfileRestored={onProfileRestored}
      />
    </section>
  );
}

function MissingSettingsScreen() {
  return (
    <section className="state-shell" aria-labelledby="missing-settings-title">
      <p className="context-line">Доступ ограничен</p>
      <h1 id="missing-settings-title">Настройки недоступны</h1>
      <p className="lede">
        Раздел существует только для администратора. Сведения об учётках, путях и Codex runtime не
        раскрываются.
      </p>
      <Link className="button button--primary" href="/">
        Открыть свою карточку
      </Link>
    </section>
  );
}

function LoadingScreen({ copy = "Открываем семейное пространство…" }: { copy?: string }) {
  return (
    <section className="state-shell" aria-live="polite" aria-busy="true">
      <p className="context-line">Veylta</p>
      <div className="skeleton skeleton--title" aria-hidden="true" />
      <div className="skeleton skeleton--copy" aria-hidden="true" />
      <p className="state-copy">{copy}</p>
    </section>
  );
}

function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="state-shell" aria-labelledby="error-title">
      <p className="context-line">Соединение прервано</p>
      <h1 id="error-title">Пространство пока не открылось</h1>
      <p className="lede">
        Данные не изменились. Проверьте соединение с локальным API и повторите.
      </p>
      <button className="button button--primary" type="button" onClick={onRetry}>
        Повторить
      </button>
    </section>
  );
}

function MissingProfileScreen({
  fallbackProfile,
}: {
  fallbackProfile: PatientProfileSummary | undefined;
}) {
  return (
    <section className="state-shell" aria-labelledby="missing-profile-title">
      <p className="context-line">Доступ ограничен</p>
      <h1 id="missing-profile-title">Профиль недоступен</h1>
      <p className="lede">
        Профиля нет или у этой сессии нет к нему доступа. Мы не раскрываем дополнительные сведения.
      </p>
      {fallbackProfile !== undefined ? (
        <Link
          className="button button--primary"
          href={profilePath(fallbackProfile.familyId, fallbackProfile.id)}
        >
          Открыть доступный профиль
        </Link>
      ) : (
        <Link className="button button--primary" href="/">
          На главную
        </Link>
      )}
    </section>
  );
}

function NoAuthorizedProfilesScreen() {
  return (
    <section className="state-shell" aria-labelledby="no-authorized-profiles-title">
      <p className="context-line">Доступ ожидает согласия</p>
      <h1 id="no-authorized-profiles-title">Пока нет доступных профилей</h1>
      <p className="lede">
        Владелец семьи должен явно открыть вам чтение конкретного профиля. Имена и данные профилей
        до этого не показываются.
      </p>
      <p className="state-copy">После выдачи согласия обновите эту страницу.</p>
    </section>
  );
}

interface AccountAccessScreenProps {
  mode: "setup" | "login";
  pending: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function AccountAccessScreen({ mode, pending, error, onSubmit }: AccountAccessScreenProps) {
  return (
    <section className="onboarding-shell" aria-labelledby="onboarding-title">
      <div className="onboarding-intro">
        <p className="context-line">Домашняя история здоровья</p>
        <h1 id="onboarding-title">
          {mode === "setup" ? "Настройте домашнюю Veylta" : "Войдите в Veylta"}
        </h1>
        <p className="lede">
          {mode === "setup"
            ? "Первый вход создаёт администратора, его личную карточку и закрытое семейное пространство."
            : "Откройте свою карточку или профиль, к которому вам выдали доступ."}
        </p>
        <div className="privacy-note">
          <span className="privacy-note__mark" aria-hidden="true">
            L
          </span>
          <div>
            <strong>SQLite и документы остаются дома</strong>
            <p>
              Veylta работает на вашем сервере. Пароль хранится только как стойкий scrypt-хеш,
              сессия — в HttpOnly cookie.
            </p>
          </div>
        </div>
        <SystemStatus />
      </div>

      <div className="onboarding-actions">
        <form
          className="onboarding-form account-access-form"
          onSubmit={onSubmit}
          noValidate={mode === "setup"}
          aria-busy={pending}
          aria-describedby="account-form-note"
        >
          <div className="form-heading">
            <p>{mode === "setup" ? "Первый запуск" : "Защищённая сессия"}</p>
            <h2>{mode === "setup" ? "Главная учётная запись" : "Учётная запись"}</h2>
          </div>

          <label className="field">
            <span>Логин</span>
            <input
              name="username"
              type="text"
              aria-label="Логин"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
              autoCapitalize="none"
              autoComplete="username"
              aria-describedby="account-username-hint"
              spellCheck={false}
              placeholder="home-admin"
              disabled={pending}
            />
            <small id="account-username-hint" className="field-hint">
              3–32 латинских символа; можно использовать цифры, точку, дефис и подчёркивание.
            </small>
          </label>

          {mode === "setup" ? (
            <label className="field">
              <span>Ваше имя</span>
              <input
                name="displayName"
                type="text"
                aria-label="Ваше имя"
                required
                minLength={1}
                maxLength={120}
                aria-describedby="account-display-name-hint"
                autoComplete="name"
                placeholder="Как обращаться в интерфейсе"
                disabled={pending}
              />
              <small id="account-display-name-hint" className="field-hint">
                Это имя будет видно только пользователям вашего домашнего сервера.
              </small>
            </label>
          ) : null}

          <label className="field">
            <span>Пароль</span>
            <input
              name="password"
              type="password"
              aria-label="Пароль"
              required
              minLength={12}
              maxLength={128}
              aria-describedby={mode === "setup" ? "account-password-hint" : undefined}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              disabled={pending}
            />
            {mode === "setup" ? (
              <small id="account-password-hint" className="field-hint">
                Не менее 12 символов. Пароль остаётся только на домашнем сервере.
              </small>
            ) : null}
          </label>

          {mode === "setup" ? (
            <label className="field">
              <span>Повторите пароль</span>
              <input
                name="passwordConfirmation"
                type="password"
                aria-label="Повторите пароль"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                disabled={pending}
              />
            </label>
          ) : null}

          {error !== null ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="button button--primary button--wide" type="submit" disabled={pending}>
            {pending
              ? mode === "setup"
                ? "Создаём администратора…"
                : "Входим…"
              : mode === "setup"
                ? "Создать администратора"
                : "Войти"}
          </button>
          <p id="account-form-note" className="form-note">
            {mode === "setup"
              ? "Этот администратор сможет подключить Codex, настроить хранилище и создать остальные учётные записи."
              : "Доступ определяется сервером: администратор, владелец карточки или явно выданное разрешение."}
          </p>
        </form>
      </div>
    </section>
  );
}

interface ProfileWorkspaceProps {
  session: SessionResponse;
  family: SessionFamily;
  profile: PatientProfileSummary;
  requestedDocumentId: string | undefined;
  requestedAssistantId: AssistantId | undefined;
  requestedConversationId: string | undefined;
  requestedAssistantAsk: string | undefined;
  activeTab: ProfileTab;
  requestedCanonicalCode?: string | undefined;
  error: string | null;
  onProfileChange: (familyId: string, profileId: string) => void;
}

function ProfileWorkspace({
  session,
  family,
  profile,
  requestedDocumentId,
  requestedAssistantId,
  requestedConversationId,
  requestedAssistantAsk,
  activeTab,
  requestedCanonicalCode,
  error,
  onProfileChange,
}: ProfileWorkspaceProps) {
  const router = useRouter();
  /** A detail view replaces the tab panels: one document, or one assistant. */
  const detail =
    requestedDocumentId !== undefined
      ? "document"
      : requestedAssistantId !== undefined
        ? "assistant"
        : null;
  const profiles = session.families.flatMap((sessionFamily) => sessionFamily.profiles);
  const canWriteProfile = profile.access !== "granted_read";
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  /** Bumped when the dossier writes into the plan, so the plan below reloads and shows the visit. */
  const [planVersion, setPlanVersion] = useState(0);
  /** Bumped when the dossier changes the medical profile, so the heading's identity chips follow. */
  const [medicalProfileVersion, setMedicalProfileVersion] = useState(0);
  const [selectedUploads, setSelectedUploads] = useState<readonly File[]>([]);
  const [codexConsent, setCodexConsent] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const uploadDialog = useRef<HTMLDialogElement>(null);
  const uploadAttempts = useRef(new Map<string, string>());
  const now = new Date();
  const greeting =
    now.getHours() < 12 ? "Доброе утро" : now.getHours() < 18 ? "Добрый день" : "Добрый вечер";
  const dashboardDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(now);
  const uploadNoticeLocationKey = `${activeTab}:${requestedDocumentId ?? ""}`;

  useEffect(() => {
    const dialog = uploadDialog.current;
    if (dialog === null) return;
    if (uploadOpen && !dialog.open) dialog.showModal();
    if (!uploadOpen && dialog.open) dialog.close();
  }, [uploadOpen]);

  useEffect(() => {
    if (
      uploadNoticeLocationKey.length > 0 &&
      new URLSearchParams(window.location.search).get("upload") === "already_exists"
    ) {
      setUploadNotice("Этот файл уже есть в архиве — открываем существующий документ.");
    }
  }, [uploadNoticeLocationKey]);

  function openUploadDialog() {
    setSelectedUploads([]);
    setCodexConsent(false);
    setDocumentError(null);
    setUploadNotice(null);
    setDragActive(false);
    setUploadOpen(true);
  }

  function closeUploadDialog() {
    if (uploadPending) return;
    setUploadOpen(false);
  }

  function uploadFingerprint(file: File) {
    return `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
  }

  function selectUploads(files: readonly File[]) {
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (
        file.size === 0 ||
        file.size > MAX_SYNTHETIC_DOCUMENT_BYTES ||
        !isSupportedSyntheticDocument(file)
      ) {
        rejected.push(file.name || "без имени");
        continue;
      }
      valid.push(file);
    }
    setSelectedUploads((current) => {
      const known = new Set(current.map(uploadFingerprint));
      const merged = [...current];
      for (const file of valid) {
        const fingerprint = uploadFingerprint(file);
        if (!known.has(fingerprint) && merged.length < 20) {
          merged.push(file);
          known.add(fingerprint);
        }
      }
      return merged;
    });
    setDocumentError(
      rejected.length > 0
        ? `Не добавлены: ${rejected.join(", ")}. Нужны PDF, PNG или JPEG до 5 МБ.`
        : valid.length > 20
          ? "За один раз можно загрузить не больше 20 документов."
          : null,
    );
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    selectUploads(Array.from(event.dataTransfer.files));
  }

  function uploadFailureMessage(error: unknown) {
    if (error instanceof ApiError) {
      if (error.status === 413 || error.code === "PAYLOAD_TOO_LARGE") {
        return "Файл превышает лимит 5 МБ. Выберите документ меньшего размера.";
      }
      if (
        error.code === "INVALID_DOCUMENT_SIGNATURE" ||
        error.code === "UNSUPPORTED_DOCUMENT_TYPE" ||
        error.code === "INVALID_MULTIPART_UPLOAD" ||
        error.status === 415
      ) {
        return "Файл не похож на поддерживаемый PDF, PNG или JPEG. Проверьте формат и содержимое.";
      }
      if (error.status === 409) {
        return "Не удалось безопасно повторить эту загрузку. Удалите файл из списка и добавьте его снова.";
      }
    }
    return "Документ не загрузился. Исходник не изменён; проверьте соединение и повторите попытку.";
  }

  async function handleDocumentUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDocumentError(null);

    if (selectedUploads.length === 0) {
      setDocumentError("Выберите хотя бы один PDF, PNG или JPEG-файл.");
      return;
    }
    if (!codexConsent) {
      setDocumentError("Подтвердите передачу содержимого документов в Codex.");
      return;
    }

    setUploadPending(true);
    const failed: Array<{ file: File; error: unknown }> = [];
    let singleDocumentId: string | null = null;
    let reusedDocumentCount = 0;
    try {
      for (const file of selectedUploads) {
        const fingerprint = uploadFingerprint(file);
        const key = uploadAttempts.current.get(fingerprint) ?? crypto.randomUUID();
        uploadAttempts.current.set(fingerprint, key);
        const body = new FormData();
        body.append("file", file, file.name);
        try {
          const response = await apiRequest<DocumentUploadResponse>(
            `/v1/families/${encodeURIComponent(family.id)}/profiles/${encodeURIComponent(profile.id)}/documents`,
            {
              method: "POST",
              headers: {
                "Idempotency-Key": key,
                "X-Veylta-Document-Intelligence": "codex/v1",
              },
              body,
            },
          );
          if (response.disposition === "already_exists") reusedDocumentCount += 1;
          if (selectedUploads.length === 1) singleDocumentId = response.document.id;
          uploadAttempts.current.delete(fingerprint);
        } catch (requestError) {
          if (
            requestError instanceof ApiError &&
            [400, 409, 413, 415].includes(requestError.status)
          ) {
            uploadAttempts.current.delete(fingerprint);
          }
          failed.push({ file, error: requestError });
        }
      }
      if (failed.length > 0) {
        setSelectedUploads(failed.map(({ file }) => file));
        if (selectedUploads.length === 1) {
          setDocumentError(uploadFailureMessage(failed[0]?.error));
        } else if (failed.length === selectedUploads.length) {
          setDocumentError(
            `${failed.length} документа не загрузились. Ничего не передано Codex; проверьте файлы и повторите попытку.`,
          );
        } else {
          setDocumentError(
            `${failed.length} ${failed.length === 1 ? "документ не загрузился" : "документа не загрузились"}. Остальные уже переданы Codex.`,
          );
        }
      } else {
        setUploadOpen(false);
        const destination =
          singleDocumentId === null
            ? profileTabPath(family.id, profile.id, "documents")
            : documentPath(family.id, profile.id, singleDocumentId);
        const reusedDestination =
          reusedDocumentCount === 0
            ? destination
            : `${destination}${destination.includes("?") ? "&" : "?"}upload=already_exists`;
        if (reusedDocumentCount > 0) {
          setUploadNotice(
            selectedUploads.length === 1
              ? "Этот файл уже есть в архиве — открываем существующий документ."
              : `${countCopy(reusedDocumentCount, ["файл уже есть", "файла уже есть", "файлов уже есть"])} в архиве. Новые документы добавлены отдельно.`,
          );
        }
        router.push(reusedDestination);
        router.refresh();
      }
    } finally {
      setUploadPending(false);
    }
  }

  return (
    <section
      className={`profile-shell profile-shell--${detail === null ? activeTab : detail === "document" ? "documents" : "assistant"}${detail === null ? "" : " profile-shell--document-detail"}`}
      aria-label={
        detail === null && activeTab !== "documents" && activeTab !== "dossier"
          ? undefined
          : detail === "assistant" && requestedAssistantId !== undefined
            ? assistantIdentity[requestedAssistantId].title
            : detail === null && activeTab === "dossier"
              ? "Досье"
              : "Документы профиля"
      }
      aria-labelledby={
        detail === null && activeTab !== "documents" && activeTab !== "dossier"
          ? "profile-title"
          : undefined
      }
    >
      {/* The documents and dossier tabs open on their own identity — the greeting steps aside. */}
      {detail === null && activeTab !== "documents" && activeTab !== "dossier" ? (
        <div className="profile-heading">
          <div>
            <p className="context-line">
              <span>{family.displayName}</span>
              <span aria-hidden="true">/</span>
              <span>{profile.kind === "dependent" ? "Зависимый профиль" : "Взрослый профиль"}</span>
            </p>
            <h1 id="profile-title" aria-label={profile.displayName}>
              {greeting}, {profile.displayName.split(" ")[0]}
            </h1>
            <p className="profile-owner">
              Документы, сигналы и план заботы этого профиля — в одном месте.
            </p>
            <div className="profile-heading__access">
              <span>
                {family.role === "owner" ? "Владелец пространства" : "Участник пространства"}
              </span>
              {profile.access === "granted_read" ? <span>Только чтение</span> : null}
              <IdentityChips
                key={`identity:${family.id}:${profile.id}:${medicalProfileVersion}`}
                familyId={family.id}
                profileId={profile.id}
              />
            </div>
          </div>

          <div className="profile-heading__controls">
            <span className="profile-heading__control">
              <CalendarDays size={18} aria-hidden="true" />
              {dashboardDate}
            </span>
            <span className="profile-heading__control">
              <Clock3 size={18} aria-hidden="true" />
              30 дней
            </span>
            <label className="profile-switcher">
              <span className="visually-hidden">Активный профиль</span>
              <select
                aria-label="Активный профиль"
                value={profile.id}
                onChange={(event) => {
                  const selected = profiles.find((item) => item.id === event.target.value);
                  if (selected !== undefined) onProfileChange(selected.familyId, selected.id);
                }}
              >
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            {canWriteProfile ? (
              <button
                className="profile-heading__upload"
                type="button"
                aria-label="Загрузить документ"
                onClick={openUploadDialog}
              >
                Загрузить
                <span aria-hidden="true">
                  <ArrowRight size={18} />
                </span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <p className="form-error workspace-error" role="alert">
          {error}
        </p>
      ) : null}

      {uploadNotice === null ? null : (
        <div className="upload-reuse-notice" role="status">
          <CheckCheck size={18} aria-hidden="true" />
          <span>{uploadNotice}</span>
          <button
            type="button"
            onClick={() => setUploadNotice(null)}
            aria-label="Закрыть сообщение"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {detail === null && activeTab === "overview" ? (
        <div
          id="workspace-panel-overview"
          className="workspace-tab-panel workspace-tab-panel--overview"
          role="tabpanel"
          aria-labelledby="workspace-tab-overview"
          aria-label="Обзор"
        >
          <ProfileOverviewPanel
            key={`overview:${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
            canWriteProfile={canWriteProfile}
            view="dashboard"
            onUpload={openUploadDialog}
          />
        </div>
      ) : null}

      {detail === null && activeTab === "documents" ? (
        <div
          id="workspace-panel-documents"
          className="workspace-tab-panel workspace-tab-panel--documents"
          role="tabpanel"
          aria-labelledby="workspace-tab-documents"
          aria-label="Документы"
        >
          <div className="documents-workspace">
            {canWriteProfile ? null : <ReadOnlyProfileNotice />}
            <ProfileOverviewPanel
              key={`documents:${family.id}:${profile.id}`}
              familyId={family.id}
              profileId={profile.id}
              canWriteProfile={canWriteProfile}
              view="documents"
              onUpload={openUploadDialog}
            />
          </div>
        </div>
      ) : null}

      {detail === null && activeTab === "history" ? (
        <div
          id="workspace-panel-history"
          className="workspace-tab-panel workspace-tab-panel--history"
          role="tabpanel"
          aria-labelledby="workspace-tab-history"
          aria-label="История"
        >
          <ObservationHistoryPanel
            key={`${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
            canonicalCode={requestedCanonicalCode}
          />
          <IndicatorCatalogPanel
            key={`indicators:${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
            canonicalCode={requestedCanonicalCode}
          />
        </div>
      ) : null}

      {detail === null && activeTab === "dossier" ? (
        <div
          id="workspace-panel-dossier"
          className="workspace-tab-panel workspace-tab-panel--dossier"
          role="tabpanel"
          aria-labelledby="workspace-tab-dossier"
          aria-label="Досье"
        >
          <DossierPanel
            key={`dossier:${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
            displayName={profile.displayName}
            canWriteProfile={canWriteProfile}
            onPlanChanged={() => setPlanVersion((current) => current + 1)}
            onProfileChanged={() => setMedicalProfileVersion((current) => current + 1)}
          />
          <HealthSummaryPanel
            key={`summary:${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
          />
          <CarePlanPanel
            key={`plan:${family.id}:${profile.id}:${planVersion}`}
            familyId={family.id}
            profileId={profile.id}
            canWriteProfile={canWriteProfile}
          />
        </div>
      ) : null}

      {requestedAssistantId !== undefined ? (
        <div
          id="workspace-panel-assistant"
          className="workspace-tab-panel workspace-tab-panel--overview workspace-tab-panel--assistant"
          role="tabpanel"
          aria-labelledby="workspace-tab-overview"
          aria-label={assistantIdentity[requestedAssistantId].title}
        >
          <AssistantHeader
            assistantId={requestedAssistantId}
            familyId={family.id}
            profileId={profile.id}
          />
          <AssistantWorkspace
            key={`assistant:${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
            assistantId={requestedAssistantId}
            requestedConversationId={requestedConversationId}
            ask={parseAsk(requestedAssistantAsk)}
          />
        </div>
      ) : null}

      {requestedDocumentId !== undefined ? (
        <div
          id="workspace-panel-documents"
          className="workspace-tab-panel workspace-tab-panel--documents workspace-tab-panel--document-detail"
          role="tabpanel"
          aria-labelledby="workspace-tab-documents"
          aria-label="Документы"
        >
          <div className="document-detail-workspace">
            <DocumentView
              family={family}
              profile={profile}
              documentId={requestedDocumentId}
              canWriteProfile={canWriteProfile}
            />
          </div>
        </div>
      ) : null}

      {canWriteProfile ? (
        <DocumentUploadDialog
          dialogRef={uploadDialog}
          open={uploadOpen}
          pending={uploadPending}
          selectedFiles={selectedUploads}
          codexConsent={codexConsent}
          error={documentError}
          dragActive={dragActive}
          onClose={closeUploadDialog}
          onClosed={() => {
            setUploadOpen(false);
            setSelectedUploads([]);
            setCodexConsent(false);
            setDocumentError(null);
            setDragActive(false);
          }}
          onDragActiveChange={setDragActive}
          onDrop={handleDrop}
          onSelect={selectUploads}
          onRemove={(file) => {
            const fingerprint = uploadFingerprint(file);
            uploadAttempts.current.delete(fingerprint);
            setSelectedUploads((current) =>
              current.filter((candidate) => uploadFingerprint(candidate) !== fingerprint),
            );
          }}
          onConsentChange={setCodexConsent}
          onSubmit={handleDocumentUpload}
        />
      ) : null}
    </section>
  );
}

function ReadOnlyProfileNotice() {
  return (
    <section className="read-only-profile" aria-labelledby="read-only-profile-title">
      <p className="context-line">Только чтение</p>
      <h2 id="read-only-profile-title">Доступ выдан владельцем профиля</h2>
      <p>
        Здесь можно читать источник и подтверждённую историю. Загрузка, повторная обработка и
        проверка извлечений остаются только у владельца или личного профиля.
      </p>
    </section>
  );
}

function ProfileManagementRail({
  family,
  profile,
  ownerCanAddProfile,
  addProfileOpen,
  action,
  error,
  onAddProfileToggle,
  onAddProfile,
  onProfileArchived,
  onProfileRestored,
}: {
  family: SessionFamily;
  profile: PatientProfileSummary;
  ownerCanAddProfile: boolean;
  addProfileOpen: boolean;
  action: "setup" | "login" | "add-profile" | "logout" | null;
  error: string | null;
  onAddProfileToggle: () => void;
  onAddProfile: (event: FormEvent<HTMLFormElement>, family: SessionFamily) => void;
  onProfileArchived: () => Promise<void>;
  onProfileRestored: () => Promise<void>;
}) {
  return (
    <aside className="workspace-rail" aria-label="Действия с профилем">
      {ownerCanAddProfile ? (
        <div className="profile-addition">
          <h2>Семейные профили</h2>
          <p>Добавьте человека без отдельного входа, если это нужно для проверки сценария.</p>
          <button
            className="button button--secondary"
            type="button"
            aria-expanded={addProfileOpen}
            aria-controls="add-profile-form"
            onClick={onAddProfileToggle}
          >
            {addProfileOpen ? "Закрыть форму" : "Добавить профиль"}
          </button>
          {addProfileOpen ? (
            <form
              id="add-profile-form"
              className="inline-form"
              onSubmit={(event) => onAddProfile(event, family)}
            >
              <div>
                <h3>Зависимый профиль</h3>
                <p>Для ребёнка или другого человека без отдельного входа.</p>
              </div>
              <label className="field">
                <span>Имя нового профиля</span>
                <input
                  name="profileName"
                  type="text"
                  required
                  minLength={1}
                  maxLength={120}
                  autoComplete="off"
                  placeholder="Например, Подопечный 01"
                  disabled={action === "add-profile"}
                />
              </label>
              {error !== null ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                className="button button--primary"
                type="submit"
                disabled={action === "add-profile"}
              >
                {action === "add-profile" ? "Создаём…" : "Создать профиль"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {family.role === "owner" ? (
        <ProfileArchivePanel
          key={`archive:${family.id}:${profile.id}`}
          familyId={family.id}
          profile={profile}
          activeProfileCount={family.profiles.length}
          onArchived={onProfileArchived}
          onRestored={onProfileRestored}
        />
      ) : null}
      {family.role === "owner" ? <FamilyInvitationPanel familyId={family.id} /> : null}
      {family.role === "owner" ? (
        <ProfileConsentPanel
          key={`consent:${family.id}:${profile.id}`}
          familyId={family.id}
          profileId={profile.id}
        />
      ) : null}
      {family.role === "owner" ? (
        <FamilyAuditLogPanel key={`audit:${family.id}`} familyId={family.id} />
      ) : null}
    </aside>
  );
}

type ProfileArchivePanelState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "pending" }
  | { kind: "error" };

type ArchivedProfilesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: ArchivedProfileListResponse["items"] }
  | { kind: "error" };

function ProfileArchivePanel({
  familyId,
  profile,
  activeProfileCount,
  onArchived,
  onRestored,
}: {
  familyId: string;
  profile: PatientProfileSummary;
  activeProfileCount: number;
  onArchived: () => Promise<void>;
  onRestored: () => Promise<void>;
}) {
  const [archiveState, setArchiveState] = useState<ProfileArchivePanelState>({ kind: "idle" });
  const [archivedProfiles, setArchivedProfiles] = useState<ArchivedProfilesState>({ kind: "idle" });
  const [restoringProfileId, setRestoringProfileId] = useState<string | null>(null);
  const canArchive = activeProfileCount > 1;

  async function loadArchivedProfiles(): Promise<void> {
    setArchivedProfiles({ kind: "loading" });
    try {
      const response = await apiRequest<ArchivedProfileListResponse>(
        archivedProfilesPath(familyId),
      );
      setArchivedProfiles({ kind: "ready", items: response.items });
    } catch {
      setArchivedProfiles({ kind: "error" });
    }
  }

  async function archive(): Promise<void> {
    setArchiveState({ kind: "pending" });
    try {
      await apiRequest<ProfileArchiveResponse>(profileArchivePath(familyId, profile.id), {
        method: "POST",
      });
      await onArchived();
    } catch {
      setArchiveState({ kind: "error" });
    }
  }

  async function restore(profileId: string): Promise<void> {
    setRestoringProfileId(profileId);
    try {
      await apiRequest<ProfileRestoreResponse>(profileRestorePath(familyId, profileId), {
        method: "POST",
      });
      await loadArchivedProfiles();
      await onRestored();
    } catch {
      setArchivedProfiles({ kind: "error" });
    } finally {
      setRestoringProfileId(null);
    }
  }

  return (
    <section className="profile-archive rail-section" aria-labelledby="profile-archive-title">
      <p className="context-line">Обратимое ограничение доступа</p>
      <h2 id="profile-archive-title">Архив профиля</h2>
      <p>
        Архив скроет этот профиль и его источники из активного доступа. Исходники, значения и
        объекты хранения не удаляются; восстановить профиль может только владелец.
      </p>

      {!canArchive ? (
        <p className="profile-archive__note">Последний активный профиль нельзя архивировать.</p>
      ) : archiveState.kind === "confirming" ? (
        <div className="profile-archive__confirmation" role="alert">
          <strong>Подтвердите архивирование</strong>
          <span>Профиль исчезнет из активной навигации, но исходники не будут удалены.</span>
          <div>
            <button className="button button--danger" type="button" onClick={() => void archive()}>
              Подтвердить архивирование
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setArchiveState({ kind: "idle" })}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button
          className="button button--danger"
          type="button"
          onClick={() => setArchiveState({ kind: "confirming" })}
          disabled={archiveState.kind === "pending"}
        >
          Архивировать профиль
        </button>
      )}

      {archiveState.kind === "error" ? (
        <p className="form-error" role="alert">
          Не удалось архивировать профиль. Проверьте активный доступ и повторите.
        </p>
      ) : null}

      <div className="profile-archive__restore">
        <h3>Восстановить из архива</h3>
        {archivedProfiles.kind === "idle" ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadArchivedProfiles()}
          >
            Показать архивные профили
          </button>
        ) : null}
        {archivedProfiles.kind === "loading" ? <p aria-live="polite">Загружаем архив…</p> : null}
        {archivedProfiles.kind === "error" ? (
          <p className="form-error" role="alert">
            Не удалось открыть или восстановить архивный профиль.
          </p>
        ) : null}
        {archivedProfiles.kind === "ready" && archivedProfiles.items.length === 0 ? (
          <p className="profile-archive__note">Архивных профилей пока нет.</p>
        ) : null}
        {archivedProfiles.kind === "ready" && archivedProfiles.items.length > 0 ? (
          <ul className="profile-archive__list">
            {archivedProfiles.items.map((item) => (
              <li key={item.id}>
                <strong>{item.displayName}</strong>
                <span>Архивирован {formatDate(item.archivedAt)}</span>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={restoringProfileId !== null}
                  onClick={() => void restore(item.id)}
                >
                  {restoringProfileId === item.id
                    ? "Восстанавливаем…"
                    : `Восстановить ${item.displayName}`}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function FamilyInvitationPanel({ familyId }: { familyId: string }) {
  const [role, setRole] = useState<FamilyInvitationRole>("adult_member");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "ready"; code: string; expiresAt: string }
    | { kind: "error" }
  >({ kind: "idle" });

  async function createInvitation(): Promise<void> {
    setState({ kind: "pending" });
    try {
      const response = await apiRequest<FamilyInvitationCreateResponse>(
        `/v1/families/${encodeURIComponent(familyId)}/invitations`,
        { method: "POST", body: JSON.stringify({ role }) },
      );
      setState({
        kind: "ready",
        code: response.invitation.code,
        expiresAt: response.invitation.expiresAt,
      });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <section className="family-invitation rail-section" aria-labelledby="family-invitation-title">
      <p className="context-line">Локальный доступ</p>
      <h2 id="family-invitation-title">Пригласить участника</h2>
      <p>
        Одноразовый код не открывает ни один профиль. Взрослый получает личный профиль; помощник по
        уходу не получает профиль, пока владелец отдельно не разрешит чтение.
      </p>
      {state.kind === "ready" ? (
        <div className="family-invitation__code" role="status">
          <strong>Скопируйте код сейчас</strong>
          <code>{state.code}</code>
          <span>Действует до {formatDate(state.expiresAt)} и не будет показан снова.</span>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setState({ kind: "idle" })}
          >
            Готово
          </button>
        </div>
      ) : (
        <>
          <label className="field family-invitation__role">
            <span>Роль приглашения</span>
            <select
              value={role}
              disabled={state.kind === "pending"}
              onChange={(event) => setRole(event.target.value as FamilyInvitationRole)}
            >
              <option value="adult_member">Взрослый участник</option>
              <option value="caregiver">Помощник по уходу</option>
            </select>
          </label>
          <button
            className="button button--secondary"
            type="button"
            disabled={state.kind === "pending"}
            onClick={() => void createInvitation()}
          >
            {state.kind === "pending"
              ? "Создаём код…"
              : role === "caregiver"
                ? "Создать код для помощника"
                : "Создать код для взрослого"}
          </button>
          {state.kind === "error" ? (
            <p className="form-error" role="alert">
              Не удалось создать приглашение. Данные семьи не изменились.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

type ConsentPanelState =
  | { kind: "loading" }
  | {
      kind: "ready";
      members: readonly FamilyConsentMemberListResponse["items"][number][];
      grants: readonly ProfileConsentGrant[];
    }
  | { kind: "error" };

function ProfileConsentPanel({ familyId, profileId }: { familyId: string; profileId: string }) {
  const [state, setState] = useState<ConsentPanelState>({ kind: "loading" });
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [revokePendingId, setRevokePendingId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const [members, grants] = await Promise.all([
          apiRequest<FamilyConsentMemberListResponse>(
            familyConsentMembersPath(familyId),
            signal === undefined ? undefined : { signal },
          ),
          apiRequest<ProfileConsentGrantListResponse>(
            profileConsentGrantsPath(familyId, profileId),
            signal === undefined ? undefined : { signal },
          ),
        ]);
        if (!signal?.aborted)
          setState({ kind: "ready", members: members.items, grants: grants.items });
      } catch {
        if (!signal?.aborted) setState({ kind: "error" });
      }
    },
    [familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function grant(memberId: string): Promise<void> {
    setPendingUserId(memberId);
    try {
      const response = await apiRequest<ProfileConsentGrantCreateResponse>(
        profileConsentGrantsPath(familyId, profileId),
        {
          method: "POST",
          body: JSON.stringify({ granteeUserId: memberId, capability: "profile.read" }),
        },
      );
      setState((current) =>
        current.kind !== "ready"
          ? current
          : { ...current, grants: [...current.grants, response.grant] },
      );
    } catch {
      setState({ kind: "error" });
    } finally {
      setPendingUserId(null);
    }
  }

  async function revoke(grantId: string): Promise<void> {
    setRevokePendingId(grantId);
    try {
      await apiRequest<void>(
        `${profileConsentGrantsPath(familyId, profileId)}/${encodeURIComponent(grantId)}`,
        { method: "DELETE" },
      );
      setState((current) =>
        current.kind !== "ready"
          ? current
          : { ...current, grants: current.grants.filter((grant) => grant.id !== grantId) },
      );
    } catch {
      setState({ kind: "error" });
    } finally {
      setRevokePendingId(null);
    }
  }

  const activeGranteeIds =
    state.kind === "ready"
      ? new Set(state.grants.map((grant) => grant.grantee.id))
      : new Set<string>();

  return (
    <section className="profile-consent rail-section" aria-labelledby="profile-consent-title">
      <p className="context-line">Явное согласие</p>
      <h2 id="profile-consent-title">Доступ к этому профилю</h2>
      <p>
        Взрослый участник или помощник по уходу получает только чтение этого профиля. Загрузка,
        редактирование и решения по извлечениям не передаются.
      </p>
      {state.kind === "loading" ? <p aria-live="polite">Проверяем доступ…</p> : null}
      {state.kind === "error" ? (
        <div className="profile-consent__error" role="status">
          <p>Не удалось загрузить или изменить доступ. Данные и действующие права не изменены.</p>
          <button className="button button--secondary" type="button" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.kind === "ready" && state.members.length === 0 ? (
        <p className="profile-consent__empty">
          Сначала создайте локальное приглашение и подключите взрослого участника или помощника по
          уходу.
        </p>
      ) : null}
      {state.kind === "ready" && state.members.length > 0 ? (
        <ul className="profile-consent__list" aria-label="Приглашённые участники и доступ">
          {state.members.map((member) => {
            const existing = state.grants.find((grant) => grant.grantee.id === member.id);
            return (
              <li key={member.id}>
                <strong>
                  {member.displayName}
                  <span className="profile-consent__role">
                    {member.role === "caregiver" ? "Помощник по уходу" : "Взрослый участник"}
                  </span>
                </strong>
                <span>{existing === undefined ? "Нет доступа" : "Только чтение"}</span>
                {existing === undefined ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={pendingUserId === member.id}
                    onClick={() => void grant(member.id)}
                  >
                    {pendingUserId === member.id ? "Выдаём…" : "Разрешить чтение"}
                  </button>
                ) : (
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={revokePendingId === existing.id}
                    onClick={() => void revoke(existing.id)}
                  >
                    {revokePendingId === existing.id ? "Отзываем…" : "Отозвать доступ"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {state.kind === "ready" && activeGranteeIds.size > 0 ? (
        <p className="profile-consent__note">Доступ проверяется сервером при каждом открытии.</p>
      ) : null}
    </section>
  );
}

type FamilyAuditLogItem = FamilyAuditLogResponse["items"][number];
type FamilyAuditLogState =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly FamilyAuditLogItem[]; nextCursor: string | null }
  | { kind: "error"; copy: string };

function familyAuditActionCopy(action: string): string {
  const labels: Readonly<Record<string, string>> = {
    "document.downloaded": "Открыт исходный документ",
    "document.facts.opened": "Открыты извлечённые значения",
    "document.processing.opened": "Открыт статус обработки",
    "document.uploaded": "Добавлен документ",
    "profile.evidence_bundle.exported": "Скачан локальный пакет источников",
    "profile.portable_export.exported": "Скачан полный synthetic-экспорт профиля",
    "family.audit_log.opened": "Открыт журнал действий",
    "family.created": "Создана семья",
    "family.invitation.accepted": "Принято приглашение в семью",
    "family.invitation.created": "Создано приглашение в семью",
    "indicator.catalog.opened": "Открыт каталог показателей",
    "indicator.series.opened": "Открыта динамика показателя",
    "observation.history.opened": "Открыта история подтверждённых значений",
    "profile.created": "Создан профиль",
    "profile.archived": "Архивирован профиль",
    "profile.restored": "Восстановлен профиль",
    "family.archived_profiles.opened": "Открыт список архивных профилей",
    "review.fact.confirmed": "Подтверждено извлечённое значение",
    "review.fact.corrected": "Исправлено извлечённое значение",
    "review.fact.rejected": "Отклонено извлечённое значение",
  };
  return labels[action] ?? "Выполнено действие в семейном пространстве";
}

function familyAuditResultCopy(result: FamilyAuditLogItem["result"]): string {
  if (result === "success") return "Готово";
  if (result === "denied") return "Отклонено";
  return "Не завершено";
}

function familyAuditLogErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "Журнал этого семейного пространства недоступен.";
  }
  return "Не удалось загрузить журнал. Данные семьи и документы не изменены.";
}

function FamilyAuditLogPanel({ familyId }: { familyId: string }) {
  const [auditLog, setAuditLog] = useState<FamilyAuditLogState>({ kind: "loading" });
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setAuditLog({ kind: "loading" });
      setLoadMoreError(null);
      try {
        const response = await apiRequest<FamilyAuditLogResponse>(
          `${familyAuditLogPath(familyId)}?limit=${auditLogPageSize}`,
          signal === undefined ? undefined : { signal },
        );
        if (!signal?.aborted) {
          setAuditLog({ kind: "ready", items: response.items, nextCursor: response.nextCursor });
        }
      } catch (error) {
        if (!signal?.aborted) setAuditLog({ kind: "error", copy: familyAuditLogErrorCopy(error) });
      }
    },
    [familyId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadFirstPage(controller.signal);
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
      loadMoreController.current = null;
    };
  }, [loadFirstPage]);

  async function loadNextPage(): Promise<void> {
    if (auditLog.kind !== "ready" || auditLog.nextCursor === null || loadMorePending) return;
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadMorePending(true);
    setLoadMoreError(null);
    try {
      const response = await apiRequest<FamilyAuditLogResponse>(
        `${familyAuditLogPath(familyId)}?limit=${auditLogPageSize}&cursor=${encodeURIComponent(auditLog.nextCursor)}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setAuditLog((current) =>
          current.kind !== "ready"
            ? current
            : {
                kind: "ready",
                items: [...current.items, ...response.items],
                nextCursor: response.nextCursor,
              },
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) setLoadMoreError(familyAuditLogErrorCopy(error));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setLoadMorePending(false);
      }
    }
  }

  return (
    <section
      className="family-audit-log rail-section"
      aria-labelledby="family-audit-log-title"
      aria-busy={auditLog.kind === "loading" || loadMorePending}
    >
      <p className="context-line">Прозрачность доступа</p>
      <h2 id="family-audit-log-title">Журнал действий семьи</h2>
      <p>
        Только краткие технические события: без значений, текста документов, имён файлов и скрытых
        служебных метаданных.
      </p>

      {auditLog.kind === "loading" ? (
        <div className="family-audit-log__loading" aria-live="polite">
          <div className="skeleton skeleton--audit-row" aria-hidden="true" />
          <p>Загружаем журнал действий…</p>
        </div>
      ) : null}

      {auditLog.kind === "error" ? (
        <div className="family-audit-log__empty" role="status">
          <p>{auditLog.copy}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadFirstPage()}
          >
            Повторить
          </button>
        </div>
      ) : null}

      {auditLog.kind === "ready" && auditLog.items.length === 0 ? (
        <div className="family-audit-log__empty" role="status">
          <p>
            Пока нет доступных событий. Новые безопасные действия появятся здесь без их содержимого.
          </p>
        </div>
      ) : null}

      {auditLog.kind === "ready" && auditLog.items.length > 0 ? (
        <>
          <ol className="family-audit-log__list" aria-label="Последние действия семьи">
            {auditLog.items.map((item) => (
              <li key={item.id}>
                <strong>{familyAuditActionCopy(item.action)}</strong>
                <span>
                  {familyAuditResultCopy(item.result)} · {item.actor.displayName}
                </span>
                <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
              </li>
            ))}
          </ol>
          {auditLog.nextCursor !== null ? (
            <div className="family-audit-log__more">
              <button
                className="button button--secondary"
                type="button"
                disabled={loadMorePending}
                onClick={() => void loadNextPage()}
              >
                {loadMorePending ? "Загружаем…" : "Показать ещё"}
              </button>
              {loadMoreError === null ? null : (
                <p className="form-error" role="alert">
                  {loadMoreError}
                </p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type ProfileOverviewState =
  | { kind: "loading" }
  | { kind: "ready"; overview: ProfileOverviewResponse }
  | { kind: "error"; copy: string };

type DocumentSearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; documents: readonly DocumentSummary[] }
  | { kind: "error"; query: string };

function profileOverviewErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "Обзор этого профиля недоступен. Вернитесь к доступному профилю и попробуйте снова.";
  }
  return "Не удалось загрузить обзор. Исходники и подтверждённые значения не изменены.";
}

function profileOverviewProcessingCopy(
  status: ProfileOverviewResponse["recentDocuments"][number]["processing"],
): string {
  switch (status.state) {
    case "not_started":
      return "Обработка ещё не началась";
    case "queued":
      return "В очереди обработки";
    case "security_check":
      return "Проверяем исходник";
    case "text_extraction":
      return "Извлекаем текст";
    case "document_classification":
      return "Codex определяет раздел";
    case "structured_extraction":
      return "Готовим черновые значения";
    case "validation":
      return "Проверяем черновой результат";
    case "awaiting_review":
      return `${archiveValueCountCopy(status.factCount)} ждут явной проверки`;
    case "completed":
      return `${archiveValueCountCopy(status.factCount)} подтверждены пользователем`;
    case "failed":
      return "Обработка не завершилась";
  }
}

const documentCategoryLabels: Record<(typeof DOCUMENT_CATEGORIES)[number], string> = {
  laboratory: "Анализы",
  imaging: "Снимки и исследования",
  prescription: "Назначения",
  discharge_summary: "Выписки",
  consultation: "Консультации",
  vaccination: "Вакцинация",
  insurance: "Страховые документы",
  other: "Другое",
};

type ArchiveActionState =
  | { kind: "idle" }
  | { kind: "confirming"; completed: number; total: number; documentId: string | null }
  | { kind: "restarting"; documentId: string | null }
  | { kind: "error"; copy: string };

/**
 * One row shape for every source. A row that still holds values awaiting a decision shows
 * the two counts that map onto its two verbs; every other row shows its processing state.
 */
function ArchiveRows({
  rows,
  familyId,
  profileId,
  canWrite,
  action,
  onConfirm,
  onRestart,
}: {
  rows: readonly ArchiveRow[];
  familyId: string;
  profileId: string;
  canWrite: boolean;
  action: ArchiveActionState;
  onConfirm: (entry: ProfileOverviewReviewDocument) => void;
  onRestart: (document: ProfileOverviewDocument) => void;
}) {
  return (
    <ol className="archive-list">
      {rows.map(({ document, queue }) => {
        const clean = queue === null ? 0 : bulkConfirmableCount(queue);
        const attention = queue?.needsAttentionFactCount ?? 0;
        const title = document.intelligence?.title ?? document.originalFilename;
        const confirming = action.kind === "confirming" && action.documentId === document.id;
        const restarting = action.kind === "restarting" && action.documentId === document.id;
        return (
          <li
            key={document.id}
            className={`archive-list__item${queue === null ? "" : " archive-list__item--pending"}`}
          >
            <div className="archive-list__doc">
              <span className="archive-list__icon" aria-hidden="true">
                <FileText size={18} strokeWidth={1.8} />
              </span>
              <div>
                <strong>{title}</strong>
                <span>
                  {documentKindLabel(document.contentType)} · {formatDate(document.uploadedAt)}
                  {document.intelligence === null
                    ? null
                    : ` · ${documentCategoryLabels[document.intelligence.category]}`}
                  {/* The upload's own name stays visible under a model-written title. */}
                  {title === document.originalFilename ? null : (
                    <>
                      {" · "}
                      <span className="archive-list__filename">{document.originalFilename}</span>
                    </>
                  )}
                </span>
                {document.intelligence?.shortSummary ? (
                  <p className="archive-list__summary">{document.intelligence.shortSummary}</p>
                ) : null}
              </div>
            </div>

            {queue !== null ? (
              <ul className="archive-list__chips" aria-label="Состав очереди">
                {clean > 0 ? (
                  <li className="archive-list__chip archive-list__chip--clean">
                    <CheckCheck size={14} aria-hidden="true" />
                    {archiveValueCountCopy(clean)} без замечаний
                  </li>
                ) : null}
                {attention > 0 ? (
                  <li className="archive-list__chip archive-list__chip--attention">
                    <span aria-hidden="true">!</span>
                    {archiveValueCountCopy(attention)}{" "}
                    {pluralForm(attention, ["требует", "требуют", "требуют"])} отдельной проверки
                  </li>
                ) : null}
              </ul>
            ) : (
              <span className={`document-status document-status--${document.processing.state}`}>
                {profileOverviewProcessingCopy(document.processing)}
              </span>
            )}

            <div className="archive-list__actions">
              {canWrite && queue !== null && clean > 0 ? (
                <button
                  className="button archive-list__action"
                  type="button"
                  disabled={action.kind === "confirming"}
                  onClick={() => onConfirm(queue)}
                >
                  <CheckCheck size={16} aria-hidden="true" />
                  {confirming && action.kind === "confirming"
                    ? `Подтверждаем ${action.completed} из ${action.total}…`
                    : `Подтвердить ${clean}`}
                </button>
              ) : null}
              {canWrite && isRestartable(document) ? (
                <button
                  className="archive-list__restart"
                  type="button"
                  disabled={action.kind === "restarting"}
                  onClick={() => onRestart(document)}
                  aria-label={`Перезапустить разбор ${title}`}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  <span>{restarting ? "Запускаем…" : "Перезапустить"}</span>
                </button>
              ) : null}
              <Link
                className="button button--secondary archive-list__action"
                href={documentPath(familyId, profileId, document.id)}
                aria-label={`${queue === null ? "Открыть источник" : "Открыть проверку"} ${title}`}
              >
                {queue === null ? "Открыть источник" : "Открыть проверку"}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ProfileOverviewPanel({
  familyId,
  profileId,
  canWriteProfile,
  view,
  onUpload,
}: {
  familyId: string;
  profileId: string;
  canWriteProfile: boolean;
  view: "dashboard" | "documents";
  onUpload: () => void;
}) {
  const [state, setState] = useState<ProfileOverviewState>({ kind: "loading" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<DocumentSearchState>({ kind: "idle" });
  const [searchRevision, setSearchRevision] = useState(0);

  const [archiveAction, setArchiveAction] = useState<ArchiveActionState>({ kind: "idle" });

  /**
   * Confirms only the values the review workspace would also confirm in bulk. Each decision
   * is a separate idempotent command, so a failure part-way leaves the rest untouched and
   * says exactly how far it got. One document or the whole queue: same code path.
   */
  async function confirmDocuments(
    documents: readonly ProfileOverviewReviewDocument[],
  ): Promise<void> {
    const queue = documents.filter((document) => bulkConfirmableCount(document) > 0);
    if (queue.length === 0) return;
    const single = queue.length === 1 ? (queue[0]?.id ?? null) : null;

    setArchiveAction({ kind: "confirming", completed: 0, total: 0, documentId: single });
    let completed = 0;
    let total = 0;
    try {
      for (const document of queue) {
        const response = await apiRequest<DocumentFactsResponse>(
          documentFactsPath(familyId, profileId, document.id),
        );
        const confirmable = response.items.filter(canBulkConfirmFact);
        total += confirmable.length;
        setArchiveAction({ kind: "confirming", completed, total, documentId: single });
        for (const fact of confirmable) {
          await apiRequest<FactReviewResponse>(
            `${documentFactsPath(familyId, profileId, document.id)}/${encodeURIComponent(fact.id)}/review`,
            {
              method: "POST",
              headers: { "Idempotency-Key": crypto.randomUUID() },
              body: JSON.stringify({ factVersion: fact.factVersion, decision: "confirm" }),
            },
          );
          completed += 1;
          setArchiveAction({ kind: "confirming", completed, total, documentId: single });
        }
      }
      setArchiveAction({ kind: "idle" });
      await loadOverview();
    } catch {
      setArchiveAction({
        kind: "error",
        copy:
          completed === 0
            ? "Не удалось начать подтверждение. Ни одно значение не изменено."
            : `Подтверждено ${completed} из ${total}. Остальные значения не изменены; повторите действие.`,
      });
      await loadOverview();
    }
  }

  async function restartDocuments(documents: readonly ProfileOverviewDocument[]): Promise<void> {
    const targets = documents.filter(isRestartable);
    if (targets.length === 0) return;
    const single = targets.length === 1 ? (targets[0]?.id ?? null) : null;

    setArchiveAction({ kind: "restarting", documentId: single });
    try {
      for (const document of targets) {
        await apiRequest<DocumentProcessingRestartResponse>(
          `${documentProcessingPath(familyId, profileId, document.id)}/restart`,
          { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
        );
      }
      setArchiveAction({ kind: "idle" });
      await loadOverview();
    } catch {
      setArchiveAction({
        kind: "error",
        copy: "Не удалось перезапустить разбор. Исходники не изменены; повторите действие.",
      });
      await loadOverview();
    }
  }

  const loadOverview = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const overview = await apiRequest<ProfileOverviewResponse>(
          profileOverviewPath(familyId, profileId),
          signal === undefined ? undefined : { signal },
        );
        if (!signal?.aborted) setState({ kind: "ready", overview });
      } catch (error) {
        if (!signal?.aborted) setState({ kind: "error", copy: profileOverviewErrorCopy(error) });
      }
    },
    [familyId, profileId],
  );

  const refreshOverview = useCallback(async (): Promise<void> => {
    try {
      const overview = await apiRequest<ProfileOverviewResponse>(
        profileOverviewPath(familyId, profileId),
      );
      setState({ kind: "ready", overview });
    } catch {
      // Keep the last authorized snapshot during a transient background refresh failure.
    }
  }, [familyId, profileId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

  useEffect(() => {
    if (
      state.kind !== "ready" ||
      !state.overview.recentDocuments.some((document) =>
        [
          "queued",
          "security_check",
          "text_extraction",
          "document_classification",
          "structured_extraction",
          "validation",
        ].includes(document.processing.state),
      )
    ) {
      return;
    }
    const timer = window.setTimeout(() => void refreshOverview(), 1_000);
    return () => window.clearTimeout(timer);
  }, [refreshOverview, state]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (view !== "documents" || query.length < 2) {
      setSearchState({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    setSearchState({ kind: "loading", query });
    const timeout = window.setTimeout(
      () => {
        void apiRequest<unknown>(buildDocumentSearchPath(familyId, profileId, query), {
          signal: controller.signal,
        })
          .then((response) => {
            if (!controller.signal.aborted) {
              setSearchState({
                kind: "ready",
                query,
                documents: normalizeDocumentSearchResponse(response),
              });
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) setSearchState({ kind: "error", query });
          });
      },
      searchRevision === 0 ? 260 : 0,
    );

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [familyId, profileId, searchQuery, searchRevision, view]);

  return (
    <section
      id={view === "dashboard" ? "profile-dashboard" : "document-archive"}
      className={`profile-overview profile-overview--${view}`}
      aria-labelledby="profile-overview-title"
      aria-label={view === "dashboard" ? "Обзор профиля" : "Архив документов"}
      aria-busy={state.kind === "loading"}
    >
      <h2 id="profile-overview-title" className="visually-hidden">
        {view === "dashboard" ? "Обзор профиля" : "Архив документов"}
      </h2>

      {state.kind !== "ready" && view === "documents" ? (
        <DocumentsHero
          canWrite={canWriteProfile}
          summary={null}
          bulkConfirmPending={false}
          bulkConfirmProgress={null}
          bulkConfirmError={null}
          restartAllPending={false}
          searchQuery={searchQuery}
          onSearchChange={(query) => {
            setSearchRevision(0);
            setSearchQuery(query);
          }}
          onUpload={onUpload}
          onConfirmAll={() => undefined}
          onRestartFailed={() => undefined}
        />
      ) : null}

      {state.kind === "loading" ? (
        <div className="profile-overview__loading" aria-live="polite">
          <div className="skeleton skeleton--overview-row" aria-hidden="true" />
          <div className="skeleton skeleton--overview-row" aria-hidden="true" />
          <p>Сверяем последние источники и решения…</p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="profile-overview__empty" role="status">
          <p>{state.copy}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadOverview()}
          >
            Обновить обзор
          </button>
        </div>
      ) : null}

      {state.kind === "ready" ? (
        view === "dashboard" ? (
          <ProfileDashboard overview={state.overview} onUpload={onUpload} />
        ) : (
          <>
            <DocumentsHero
              canWrite={canWriteProfile}
              summary={buildDocumentsArchiveHero(state.overview)}
              bulkConfirmPending={archiveAction.kind === "confirming"}
              bulkConfirmProgress={
                archiveAction.kind === "confirming" && archiveAction.documentId === null
                  ? `Подтверждаем ${archiveAction.completed} из ${archiveAction.total}…`
                  : null
              }
              bulkConfirmError={archiveAction.kind === "error" ? archiveAction.copy : null}
              restartAllPending={archiveAction.kind === "restarting"}
              searchQuery={searchQuery}
              onSearchChange={(query) => {
                setSearchRevision(0);
                setSearchQuery(query);
              }}
              onUpload={onUpload}
              onConfirmAll={() => void confirmDocuments(state.overview.reviewQueue.documents)}
              onRestartFailed={() => void restartDocuments(restartTargets(state.overview))}
            />
            <div className="document-library__toolbar">
              <div className="document-library__tools">
                <div className="document-library__stats">
                  <span>
                    <strong>{state.overview.recentDocuments.length}</strong>в архиве
                  </span>
                  <span>
                    <strong>{state.overview.reviewQueue.documentCount}</strong>
                    {awaitingReviewVerb(state.overview.reviewQueue.documentCount)}
                  </span>
                </div>
                {canWriteProfile ? (
                  <details className="profile-overview__exports">
                    <summary>Экспорт источников</summary>
                    <div>
                      <p className="profile-overview__export">
                        <a
                          className="text-link"
                          href={`${apiPrefix}${evidenceBundlePath(familyId, profileId)}`}
                          download
                        >
                          Скачать локальный пакет источников
                        </a>
                        <span>До 5 синтетических исходников; это не резервная копия.</span>
                      </p>
                      <p className="profile-overview__export">
                        <a
                          className="text-link"
                          href={`${apiPrefix}${portableProfileExportPath(familyId, profileId)}`}
                          download
                        >
                          Скачать полный synthetic-экспорт профиля
                        </a>
                        <span>
                          Все источники и подтверждённые записи в пределах локального лимита.
                        </span>
                      </p>
                    </div>
                  </details>
                ) : null}
              </div>
            </div>

            <div className="profile-overview__sections">
              <section
                className="profile-overview__section"
                aria-labelledby="overview-documents-title"
                aria-busy={searchState.kind === "loading"}
              >
                <header className="archive-list__heading">
                  <div>
                    <h3 id="overview-documents-title">
                      {searchState.kind === "ready"
                        ? archiveDocumentCountCopy(searchState.documents.length)
                        : "Документы"}
                    </h3>
                    <p>
                      {searchState.kind === "idle"
                        ? "Сначала — источники, которые ждут решения. Значения без замечаний можно подтвердить сразу; с замечаниями открываются по одному."
                        : `Результаты поиска по запросу «${searchState.kind === "loading" ? searchState.query : searchState.kind === "ready" || searchState.kind === "error" ? searchState.query : ""}».`}
                    </p>
                  </div>
                  {searchState.kind === "idle" && state.overview.reviewQueue.documentCount > 0 ? (
                    <dl className="archive-list__totals">
                      <div>
                        <dt>Ждут решения</dt>
                        <dd>
                          {archiveValueCountCopy(state.overview.reviewQueue.pendingFactCount)}
                        </dd>
                      </div>
                      <div>
                        <dt>Документов</dt>
                        <dd>{state.overview.reviewQueue.documentCount}</dd>
                      </div>
                    </dl>
                  ) : null}
                </header>
                {searchState.kind === "loading" ? (
                  <div className="document-search-state" role="status">
                    <span className="document-search-state__spinner" aria-hidden="true" />
                    <div>
                      <strong>Ищем по саммари и результатам</strong>
                      <p>Запрос «{searchState.query}» проверяется в локальном архиве.</p>
                    </div>
                  </div>
                ) : null}
                {searchState.kind === "error" ? (
                  <div className="document-search-state document-search-state--error" role="alert">
                    <div>
                      <strong>Поиск временно недоступен</strong>
                      <p>Архив не изменён. Можно повторить тот же запрос.</p>
                    </div>
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => setSearchRevision((current) => current + 1)}
                    >
                      Повторить
                    </button>
                  </div>
                ) : null}
                {searchState.kind === "ready" && searchState.documents.length === 0 ? (
                  <div className="profile-overview__empty document-search-empty" role="status">
                    <Search size={20} aria-hidden="true" />
                    <p>По запросу «{searchState.query}» ничего не найдено.</p>
                    <button
                      className="text-link text-link--button"
                      type="button"
                      onClick={() => setSearchQuery("")}
                    >
                      Показать весь архив
                    </button>
                  </div>
                ) : null}
                {searchState.kind === "idle" && state.overview.recentDocuments.length === 0 ? (
                  <div className="profile-overview__empty" role="status">
                    <p>
                      Исходников пока нет. Загрузите PDF, PNG или JPEG — до 20 файлов по 5 МБ за
                      раз. Codex подготовит значения для вашей проверки, а оригиналы останутся
                      неизменными.
                    </p>
                    {canWriteProfile ? (
                      <button className="button button--secondary" type="button" onClick={onUpload}>
                        <FileUp size={16} aria-hidden="true" />
                        Загрузить первый документ
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {searchState.kind === "idle" && state.overview.recentDocuments.length > 0 ? (
                  <ArchiveRows
                    rows={archiveRows(state.overview)}
                    familyId={familyId}
                    profileId={profileId}
                    canWrite={canWriteProfile}
                    action={archiveAction}
                    onConfirm={(entry) => void confirmDocuments([entry])}
                    onRestart={(document) => void restartDocuments([document])}
                  />
                ) : null}
                {searchState.kind === "ready" && searchState.documents.length > 0 ? (
                  <ArchiveRows
                    rows={archiveRows({
                      ...state.overview,
                      recentDocuments: searchState.documents,
                    })}
                    familyId={familyId}
                    profileId={profileId}
                    canWrite={canWriteProfile}
                    action={archiveAction}
                    onConfirm={(entry) => void confirmDocuments([entry])}
                    onRestart={(document) => void restartDocuments([document])}
                  />
                ) : null}
              </section>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

const carePlanLanes: ReadonlyArray<{
  category: CarePlanCategory;
  label: string;
  empty: string;
}> = [
  {
    category: "laboratory",
    label: "Анализы",
    empty: "Зафиксируйте анализ, который вы уже решили обсудить или повторить.",
  },
  {
    category: "clinician",
    label: "Специалисты",
    empty: "Врач или специальность появляются только как принятый вами пункт.",
  },
  {
    category: "nutrition",
    label: "Питание",
    empty: "Не назначаем рацион без ограничений, контекста и подтверждённого источника.",
  },
  {
    category: "activity",
    label: "Активность",
    empty: "Спортивная программа требует ваших ограничений и явного принятия.",
  },
  {
    category: "reminder",
    label: "Напоминания",
    empty: "Добавьте срок для уже принятого домашнего действия.",
  },
];

type CarePlanState =
  | { kind: "loading" }
  | { kind: "ready"; response: CarePlanResponse }
  | { kind: "error"; copy: string };

function carePlanErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "План этого профиля недоступен. Вернитесь к доступной карточке.";
  }
  if (error instanceof ApiError && error.status === 409) {
    return "План или сводка уже изменились. Обновите страницу и повторите действие.";
  }
  if (error instanceof ApiError && error.status === 503) {
    return "Codex не подготовил черновики. Проверьте в настройках вход через ChatGPT и повторите позже.";
  }
  if (error instanceof ApiError && [400, 422].includes(error.status)) {
    return "Проверьте название, примечание и дату действия.";
  }
  return "Не удалось обновить домашний план. Сохранённые пункты не изменены.";
}

function carePlanStateCopy(item: CarePlanItem): string {
  switch (item.state) {
    case "proposed":
      return "Предложение · ждёт решения";
    case "accepted":
      return item.scheduledFor === null
        ? "Принято без срока"
        : `Запланировано · ${item.scheduledFor}`;
    case "completed":
      return "Выполнено";
    case "dismissed":
      return "Отклонено";
  }
}

function CarePlanPanel({
  familyId,
  profileId,
  canWriteProfile,
}: {
  familyId: string;
  profileId: string;
  canWriteProfile: boolean;
}) {
  const formId = useId();
  const [state, setState] = useState<CarePlanState>({ kind: "loading" });
  const [formOpen, setFormOpen] = useState(false);
  const [codexDisclosureOpen, setCodexDisclosureOpen] = useState(false);
  const [codexPending, setCodexPending] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const creationAttempt = useRef<{ fingerprint: string; itemId: string } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const response = await apiRequest<CarePlanResponse>(
          carePlanPath(familyId, profileId),
          signal === undefined ? undefined : { signal },
        );
        if (!signal?.aborted) setState({ kind: "ready", response });
      } catch (loadError) {
        if (!signal?.aborted) setState({ kind: "error", copy: carePlanErrorCopy(loadError) });
      }
    },
    [familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function createItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const category = fields.get("category");
    const title = fields.get("title");
    const note = fields.get("note");
    const scheduledFor = fields.get("scheduledFor");
    if (
      typeof category !== "string" ||
      !carePlanLanes.some((lane) => lane.category === category) ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      typeof note !== "string" ||
      typeof scheduledFor !== "string"
    ) {
      setError("Заполните название домашнего действия.");
      return;
    }
    const input = {
      category: category as CarePlanCategory,
      title: title.trim(),
      note: note.trim() || null,
      scheduledFor: scheduledFor || null,
    };
    const fingerprint = JSON.stringify(input);
    if (creationAttempt.current?.fingerprint !== fingerprint) {
      creationAttempt.current = { fingerprint, itemId: crypto.randomUUID() };
    }
    const itemId = creationAttempt.current.itemId;
    setPendingItemId(itemId);
    setError(null);
    try {
      await apiRequest<CarePlanItemResponse>(
        `${carePlanPath(familyId, profileId)}/items/${encodeURIComponent(itemId)}`,
        { method: "PUT", body: JSON.stringify(input) },
      );
      creationAttempt.current = null;
      form.reset();
      setFormOpen(false);
      await load();
    } catch (requestError) {
      if (requestError instanceof ApiError && [400, 409, 422].includes(requestError.status)) {
        creationAttempt.current = null;
      }
      setError(carePlanErrorCopy(requestError));
    } finally {
      setPendingItemId(null);
    }
  }

  async function changeState(
    item: CarePlanItem,
    nextState: "accepted" | "completed" | "dismissed",
  ): Promise<void> {
    setPendingItemId(item.id);
    setError(null);
    try {
      await apiRequest<CarePlanItemResponse>(
        `${carePlanPath(familyId, profileId)}/items/${encodeURIComponent(item.id)}/state`,
        {
          method: "PUT",
          body: JSON.stringify({
            revision: item.revision,
            state: nextState,
            scheduledFor: item.scheduledFor,
          }),
        },
      );
      await load();
    } catch (requestError) {
      setError(carePlanErrorCopy(requestError));
    } finally {
      setPendingItemId(null);
    }
  }

  async function generateWithCodex(): Promise<void> {
    setCodexPending(true);
    setError(null);
    try {
      const response = await apiRequest<CarePlanProposalResponse>(
        `${carePlanPath(familyId, profileId)}/proposals`,
        {
          method: "POST",
          body: JSON.stringify({ acknowledgement: "send_confirmed_summary_to_codex" }),
        },
      );
      setCodexDisclosureOpen(false);
      await load();
      if (response.items.length === 0) {
        setError("Codex не нашёл безопасных черновиков для этой версии сводки.");
      }
    } catch (requestError) {
      setError(carePlanErrorCopy(requestError));
    } finally {
      setCodexPending(false);
    }
  }

  const canWrite = state.kind === "ready" && state.response.canWrite && canWriteProfile;

  return (
    <section
      id="care-plan"
      className="care-plan"
      aria-labelledby={`${formId}-title`}
      aria-busy={state.kind === "loading"}
    >
      <div className="care-plan__heading">
        <div>
          <p>Домашний health-care</p>
          <h3 id={`${formId}-title`}>План заботы</h3>
          <span>
            Предложения не становятся назначениями автоматически. Сначала источник, затем ваше
            решение.
          </span>
        </div>
        {canWrite ? (
          <div className="care-plan__heading-actions">
            <button
              className="button button--secondary"
              type="button"
              aria-expanded={codexDisclosureOpen}
              aria-controls={`${formId}-codex-disclosure`}
              disabled={codexPending || state.response.evidence.latestSummary === null}
              onClick={() => {
                setCodexDisclosureOpen((current) => !current);
                setFormOpen(false);
                setError(null);
              }}
            >
              {codexPending ? "Codex анализирует…" : "Предложения Codex"}
            </button>
            <button
              className="button button--secondary"
              type="button"
              aria-expanded={formOpen}
              aria-controls={`${formId}-form`}
              onClick={() => {
                setFormOpen((current) => !current);
                setCodexDisclosureOpen(false);
                setError(null);
              }}
            >
              {formOpen ? "Закрыть" : "Добавить действие"}
            </button>
          </div>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <div className="care-plan__loading" aria-live="polite">
          <div className="skeleton skeleton--overview-row" aria-hidden="true" />
          <p>Собираем план и проверяем его источники…</p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="care-plan__error" role="status">
          <p>{state.copy}</p>
          <button className="button button--secondary" type="button" onClick={() => void load()}>
            Обновить план
          </button>
        </div>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <dl className="care-plan__evidence" aria-label="Основание плана">
            <div>
              <dt>Источники</dt>
              <dd>{state.response.evidence.sourceCount}</dd>
            </div>
            <div>
              <dt>Ждут проверки</dt>
              <dd>{state.response.evidence.pendingReviewCount}</dd>
            </div>
            <div>
              <dt>Подтверждено</dt>
              <dd>{state.response.evidence.confirmedObservationCount}</dd>
            </div>
            <div>
              <dt>Версия сводки</dt>
              <dd>{state.response.evidence.latestSummary?.version ?? "—"}</dd>
            </div>
          </dl>

          {codexDisclosureOpen && canWrite ? (
            <section
              id={`${formId}-codex-disclosure`}
              className="care-plan__codex-disclosure"
              aria-labelledby={`${formId}-codex-title`}
            >
              <div>
                <p className="section-label">Внешняя обработка · ChatGPT подписка</p>
                <h4 id={`${formId}-codex-title`}>Передать подтверждённую сводку в Codex?</h4>
                <p>
                  Уйдёт только выжимка из сводки v{state.response.evidence.latestSummary?.version}:
                  названия, значения, единицы, даты, код показателя, лаборатория и метки
                  недостающего контекста. PDF, имена файлов, фрагменты, идентификаторы записей,
                  пароли и OAuth-токены не передаются.
                </p>
              </div>
              <div className="care-plan__codex-actions">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={codexPending}
                  onClick={() => void generateWithCodex()}
                >
                  {codexPending ? "Формируем черновики…" : "Да, сформировать черновики"}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={codexPending}
                  onClick={() => setCodexDisclosureOpen(false)}
                >
                  Отмена
                </button>
              </div>
              <small>
                Используется вход Codex CLI через ChatGPT. Каждый результат останется черновиком до
                вашего решения.
              </small>
            </section>
          ) : null}

          {formOpen && canWrite ? (
            <form id={`${formId}-form`} className="care-plan__form" onSubmit={createItem}>
              <label>
                <span>Направление</span>
                <select name="category" defaultValue="reminder" disabled={pendingItemId !== null}>
                  {carePlanLanes.map((lane) => (
                    <option key={lane.category} value={lane.category}>
                      {lane.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="care-plan__form-title">
                <span>Что вы решили сделать</span>
                <input
                  name="title"
                  type="text"
                  required
                  minLength={1}
                  maxLength={120}
                  autoComplete="off"
                  disabled={pendingItemId !== null}
                  placeholder="Например, обсудить повторный анализ"
                />
              </label>
              <label>
                <span>Срок</span>
                <input name="scheduledFor" type="date" disabled={pendingItemId !== null} />
              </label>
              <label className="care-plan__form-note">
                <span>Контекст для себя</span>
                <textarea
                  name="note"
                  maxLength={500}
                  rows={2}
                  disabled={pendingItemId !== null}
                  placeholder="Необязательно. Не вводите сюда пароль или ключ Codex."
                />
              </label>
              <button
                className="button button--primary"
                type="submit"
                disabled={pendingItemId !== null}
              >
                {pendingItemId === null ? "Сохранить в план" : "Сохраняем…"}
              </button>
            </form>
          ) : null}

          {error !== null ? (
            <p className="form-error care-plan__form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="care-plan__lanes">
            {carePlanLanes.map((lane) => {
              const items = state.response.items.filter(
                (item) => item.category === lane.category && item.state !== "dismissed",
              );
              return (
                <section
                  key={lane.category}
                  className="care-plan__lane"
                  aria-labelledby={`${formId}-${lane.category}`}
                >
                  <div className="care-plan__lane-heading">
                    <h4 id={`${formId}-${lane.category}`}>{lane.label}</h4>
                    <span>{items.length}</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="care-plan__empty">{lane.empty}</p>
                  ) : (
                    <ol>
                      {items.map((item) => (
                        <li key={item.id} data-state={item.state}>
                          <div>
                            <strong>{item.title}</strong>
                            <span>{carePlanStateCopy(item)}</span>
                            {item.note === null ? null : <p>{item.note}</p>}
                            {item.provenance === null ? (
                              <small>Добавлено человеком · без автоматической рекомендации</small>
                            ) : (
                              <details>
                                <summary>Почему это предложено</summary>
                                <p>
                                  Сводка v{item.provenance.healthSummary.version} · правило{" "}
                                  {item.provenance.ruleVersion}
                                </p>
                                <p>
                                  Модель {item.provenance.modelId} · runtime{" "}
                                  {item.provenance.runtimeVersion}
                                </p>
                                <p>
                                  Не хватает контекста:{" "}
                                  {item.provenance.missingContext.join(", ") || "не указано"}
                                </p>
                              </details>
                            )}
                          </div>
                          {canWrite && item.state === "proposed" ? (
                            <div className="care-plan__actions">
                              <button
                                className="text-button"
                                type="button"
                                disabled={pendingItemId !== null}
                                onClick={() => void changeState(item, "accepted")}
                              >
                                Принять
                              </button>
                              <button
                                className="text-button"
                                type="button"
                                disabled={pendingItemId !== null}
                                onClick={() => void changeState(item, "dismissed")}
                              >
                                Отклонить
                              </button>
                            </div>
                          ) : null}
                          {item.state === "accepted" && takesCheckins(item.category) ? (
                            <CarePlanCheckins
                              itemPath={`${carePlanPath(familyId, profileId)}/items/${encodeURIComponent(item.id)}`}
                              checkins={item.checkins}
                              canWrite={canWrite}
                              onRecorded={load}
                            />
                          ) : null}
                          {canWrite && item.state === "accepted" ? (
                            <button
                              className="care-plan__complete"
                              type="button"
                              disabled={pendingItemId !== null}
                              onClick={() => void changeState(item, "completed")}
                            >
                              Отметить выполненным
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

type HealthSummaryState =
  | { kind: "loading" }
  | {
      kind: "ready";
      response: HealthSummaryResponse;
      history: HealthSummaryHistoryResponse;
      comparison:
        | { kind: "idle" }
        | { kind: "loading" }
        | { kind: "ready"; response: HealthSummaryComparisonResponse }
        | { kind: "error"; copy: string };
      versionPending: boolean;
      historyPending: boolean;
      versionError: string | null;
    }
  | { kind: "error"; copy: string };

function healthSummaryErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "Сводка этого профиля недоступна. Вернитесь к доступному профилю и попробуйте снова.";
  }
  return "Не удалось загрузить сводку. Подтверждённые источники и решения не изменены.";
}

function healthSummaryComparisonErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "Одна из фиксированных версий недоступна. Вернитесь к доступному профилю и попробуйте снова.";
  }
  return "Не удалось открыть состав источников между версиями. Сводки и подтверждённые значения не изменены.";
}

function recommendationCopy(code: HealthSummaryRecommendationCode): string {
  switch (code) {
    case "prepare_source_for_clinician":
      return "Если вы обсуждаете эти данные со специалистом, откройте источник и возьмите его с собой.";
    case "complete_pending_review":
      return "Есть извлечённые значения без финального решения: подтвердите, исправьте или отклоните их до опоры на них.";
  }
}

function missingDataCopy(value: HealthSummaryMissingData): string {
  switch (value) {
    case "confirmed_observations":
      return "нет подтверждённых значений";
    case "sample_date":
      return "нет даты биоматериала";
    case "result_date":
      return "нет даты результата";
    case "laboratory":
      return "не указана лаборатория";
    case "canonical_indicator":
      return "не определён сопоставимый показатель";
  }
}

function HealthSummaryPanel({ familyId, profileId }: { familyId: string; profileId: string }) {
  const [state, setState] = useState<HealthSummaryState>({ kind: "loading" });

  const loadSummary = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const [response, history] = await Promise.all([
          apiRequest<HealthSummaryResponse>(
            healthSummaryPath(familyId, profileId),
            signal === undefined ? undefined : { signal },
          ),
          apiRequest<HealthSummaryHistoryResponse>(
            healthSummaryHistoryPath(familyId, profileId),
            signal === undefined ? undefined : { signal },
          ),
        ]);
        if (!signal?.aborted) {
          setState({
            kind: "ready",
            response,
            history,
            comparison: { kind: "idle" },
            versionPending: false,
            historyPending: false,
            versionError: null,
          });
        }
      } catch (error) {
        if (!signal?.aborted) setState({ kind: "error", copy: healthSummaryErrorCopy(error) });
      }
    },
    [familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  }, [loadSummary]);

  async function selectVersion(version: number): Promise<void> {
    if (state.kind !== "ready" || state.response.summary?.version === version) return;
    setState((current) =>
      current.kind !== "ready" ? current : { ...current, versionPending: true, versionError: null },
    );
    try {
      const response = await apiRequest<HealthSummaryResponse>(
        `${healthSummaryPath(familyId, profileId)}?version=${encodeURIComponent(String(version))}`,
      );
      if (response.summary === null) throw new Error("Missing selected summary version");
      setState((current) =>
        current.kind !== "ready"
          ? current
          : {
              ...current,
              response,
              comparison: { kind: "idle" },
              versionPending: false,
              versionError: null,
            },
      );
    } catch (error) {
      setState((current) =>
        current.kind !== "ready"
          ? current
          : {
              ...current,
              versionPending: false,
              versionError: healthSummaryErrorCopy(error),
            },
      );
    }
  }

  async function loadComparison(): Promise<void> {
    if (
      state.kind !== "ready" ||
      state.response.summary === null ||
      state.response.summary.previous === null ||
      state.comparison.kind === "loading"
    ) {
      return;
    }
    const { version } = state.response.summary;
    const { previous } = state.response.summary;
    setState((current) =>
      current.kind !== "ready" ? current : { ...current, comparison: { kind: "loading" } },
    );
    try {
      const response = await apiRequest<HealthSummaryComparisonResponse>(
        `${healthSummaryComparisonPath(familyId, profileId)}?fromVersion=${encodeURIComponent(String(previous.version))}&toVersion=${encodeURIComponent(String(version))}`,
      );
      setState((current) =>
        current.kind !== "ready"
          ? current
          : { ...current, comparison: { kind: "ready", response } },
      );
    } catch (error) {
      setState((current) =>
        current.kind !== "ready"
          ? current
          : {
              ...current,
              comparison: { kind: "error", copy: healthSummaryComparisonErrorCopy(error) },
            },
      );
    }
  }

  async function loadOlderVersions(): Promise<void> {
    if (
      state.kind !== "ready" ||
      state.history.nextBeforeVersion === null ||
      state.historyPending
    ) {
      return;
    }
    setState((current) =>
      current.kind !== "ready" ? current : { ...current, historyPending: true, versionError: null },
    );
    try {
      const next = await apiRequest<HealthSummaryHistoryResponse>(
        `${healthSummaryHistoryPath(familyId, profileId)}?beforeVersion=${encodeURIComponent(String(state.history.nextBeforeVersion))}`,
      );
      setState((current) =>
        current.kind !== "ready"
          ? current
          : {
              ...current,
              history: {
                contractVersion: current.history.contractVersion,
                versions: [...current.history.versions, ...next.versions],
                nextBeforeVersion: next.nextBeforeVersion,
              },
              historyPending: false,
              versionError: null,
            },
      );
    } catch (error) {
      setState((current) =>
        current.kind !== "ready"
          ? current
          : {
              ...current,
              historyPending: false,
              versionError: healthSummaryErrorCopy(error),
            },
      );
    }
  }

  return (
    <section
      className="health-summary"
      aria-labelledby="health-summary-title"
      aria-busy={state.kind === "loading"}
    >
      <div className="health-summary__heading">
        <p className="context-line">Подтверждённые источники · версия</p>
        <h2 id="health-summary-title">Сводка для разговора об источниках</h2>
        <p>
          Это фиксированный список явно подтверждённых значений и недостающих полей. Здесь нет
          диагноза, оценки риска, клинической интерпретации или проверки красных флагов.
        </p>
      </div>

      {state.kind === "loading" ? (
        <div className="health-summary__loading" aria-live="polite">
          <div className="skeleton skeleton--summary-line" aria-hidden="true" />
          <div className="skeleton skeleton--summary-line" aria-hidden="true" />
          <p>Сверяем последнюю фиксированную версию…</p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="health-summary__empty" role="status">
          <p>{state.copy}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadSummary()}
          >
            Обновить сводку
          </button>
        </div>
      ) : null}

      {state.kind === "ready" && state.response.summary === null ? (
        <div className="health-summary__empty">
          <p>
            Сводка появится после завершения проверки хотя бы одного документа: все извлечённые
            значения должны получить явное решение.
          </p>
          <Link className="text-link" href={profileTabPath(familyId, profileId, "documents")}>
            Добавить или проверить источник
          </Link>
        </div>
      ) : null}

      {state.kind === "ready" && state.response.summary !== null ? (
        <div className="health-summary__content">
          <div className="health-summary__meta">
            <div className="health-summary__version-control">
              <label>
                <span>Фиксированная версия</span>
                <select
                  aria-label="Версия сводки"
                  value={state.response.summary.version}
                  disabled={state.versionPending}
                  onChange={(event) => void selectVersion(Number(event.target.value))}
                >
                  {state.history.versions.map((version) => (
                    <option key={version.id} value={version.version}>
                      Версия {version.version} · {formatDate(version.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
              {state.history.nextBeforeVersion === null ? null : (
                <button
                  className="text-button health-summary__older"
                  type="button"
                  disabled={state.historyPending}
                  onClick={() => void loadOlderVersions()}
                >
                  {state.historyPending ? "Загружаем старые версии…" : "Показать старые версии"}
                </button>
              )}
              <p>
                Версия {state.response.summary.version} ·{" "}
                {formatDate(state.response.summary.createdAt)}
              </p>
            </div>
            <p>
              Источников в версии: {state.response.summary.evidenceScope.includedCount} из{" "}
              {state.response.summary.evidenceScope.totalConfirmedObservationCount} подтверждённых
            </p>
          </div>

          {state.versionError === null ? null : (
            <p className="form-error" role="alert">
              {state.versionError}
            </p>
          )}

          {state.response.summary.previous !== null ? (
            <div className="health-summary__change">
              <p role="status">
                Новых подтверждённых источников: {state.response.summary.newEvidenceCount}
                {"; "}перенесено из версии {state.response.summary.previous.version}:{" "}
                {state.response.summary.carriedForwardEvidenceCount}.
              </p>
              <button
                className="text-button"
                type="button"
                disabled={state.comparison.kind === "loading"}
                onClick={() => void loadComparison()}
              >
                {state.comparison.kind === "loading"
                  ? "Открываем состав источников…"
                  : `Показать состав источников версии ${state.response.summary.version} относительно версии ${state.response.summary.previous.version}`}
              </button>
            </div>
          ) : null}

          {state.comparison.kind === "error" ? (
            <p className="form-error" role="alert">
              {state.comparison.copy}
            </p>
          ) : null}

          {state.comparison.kind === "ready" ? (
            <section
              className="health-summary__comparison"
              aria-labelledby="summary-comparison-title"
            >
              <h3 id="summary-comparison-title">Состав источников между версиями</h3>
              <p>
                Это сопоставление только сохранённых подтверждённых источников версии{" "}
                {state.comparison.response.base.version} и версии{" "}
                {state.comparison.response.target.version}. Оно не оценивает изменение здоровья.
              </p>
              <div className="health-summary__comparison-columns">
                <section aria-labelledby="summary-comparison-added-title">
                  <h4 id="summary-comparison-added-title">
                    Добавлено в версию {state.comparison.response.target.version}
                  </h4>
                  {state.comparison.response.newlyIncluded.length === 0 ? (
                    <p>Нет новых подтверждённых источников.</p>
                  ) : (
                    <ul>
                      {state.comparison.response.newlyIncluded.map((observation) => (
                        <li key={observation.id}>
                          <strong>
                            {observation.source.name}: {observation.source.value}{" "}
                            {observation.source.unit}
                          </strong>
                          <Link
                            className="text-link"
                            href={documentPath(familyId, profileId, observation.sourceDocument.id)}
                          >
                            Открыть источник
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section aria-labelledby="summary-comparison-removed-title">
                  <h4 id="summary-comparison-removed-title">
                    Не вошло в версию {state.comparison.response.target.version}
                  </h4>
                  {state.comparison.response.noLongerIncluded.length === 0 ? (
                    <p>Все источники предыдущей версии сохранены в этой версии.</p>
                  ) : (
                    <ul>
                      {state.comparison.response.noLongerIncluded.map((observation) => (
                        <li key={observation.id}>
                          <strong>
                            {observation.source.name}: {observation.source.value}{" "}
                            {observation.source.unit}
                          </strong>
                          <Link
                            className="text-link"
                            href={documentPath(familyId, profileId, observation.sourceDocument.id)}
                          >
                            Открыть источник
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </section>
          ) : null}

          {state.response.summary.groups.map((group) => (
            <section
              key={group.id}
              className="health-summary__group"
              aria-labelledby={`summary-group-${group.id}`}
            >
              <h3 id={`summary-group-${group.id}`}>{group.label}</h3>
              <ol>
                {group.evidence.map(({ observation, isNewSincePreviousSummary }) => (
                  <li key={observation.id}>
                    <div>
                      <strong>
                        {observation.source.name}: {observation.source.value}{" "}
                        {observation.source.unit}
                      </strong>
                      <span>
                        {isNewSincePreviousSummary
                          ? "Новый источник в этой версии"
                          : "Перенесено из предыдущей версии"}
                        {" · "}документ, страница {observation.sourceDocument.pageNumber}
                      </span>
                    </div>
                    <Link
                      className="text-link"
                      href={documentPath(familyId, profileId, observation.sourceDocument.id)}
                    >
                      Открыть источник
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {state.response.summary.missingData.length > 0 ? (
            <div className="health-summary__missing" role="note">
              <strong>В источниках пока отсутствует</strong>
              <ul>
                {state.response.summary.missingData.map((item) => (
                  <li key={item}>{missingDataCopy(item)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="health-summary__recommendations" role="note">
            <strong>Осторожные следующие шаги</strong>
            <ul>
              {state.response.summary.recommendations.map(({ code }) => (
                <li key={code}>{recommendationCopy(code)}</li>
              ))}
            </ul>
            <p>Срочные симптомы и красные флаги этим локальным контуром не оцениваются.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const supportedSyntheticDocumentTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

function isSupportedSyntheticDocument(file: File): boolean {
  if (supportedSyntheticDocumentTypes.has(file.type.toLowerCase())) return true;
  return /\.(pdf|png|jpe?g)$/i.test(file.name);
}

interface DocumentUploadDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  open: boolean;
  pending: boolean;
  selectedFiles: readonly File[];
  codexConsent: boolean;
  error: string | null;
  dragActive: boolean;
  onClose: () => void;
  onClosed: () => void;
  onDragActiveChange: (active: boolean) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onSelect: (files: readonly File[]) => void;
  onRemove: (file: File) => void;
  onConsentChange: (checked: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function DocumentUploadDialog({
  dialogRef,
  open,
  pending,
  selectedFiles,
  codexConsent,
  error,
  dragActive,
  onClose,
  onClosed,
  onDragActiveChange,
  onDrop,
  onSelect,
  onRemove,
  onConsentChange,
  onSubmit,
}: DocumentUploadDialogProps) {
  return (
    <dialog
      ref={dialogRef}
      className="upload-dialog"
      aria-labelledby="upload-dialog-title"
      data-state={open ? "open" : "closed"}
      onClose={onClosed}
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <form className="upload-dialog__surface" onSubmit={onSubmit} aria-busy={pending}>
        <div className="upload-dialog__heading">
          <div>
            <p className="context-line">Новый источник</p>
            <h2 id="upload-dialog-title">Загрузить документы</h2>
            <p>
              Оригиналы останутся локально. Codex сам определит тип каждого документа и распределит
              их по разделам архива.
            </p>
          </div>
          <button
            className="workspace-icon-action upload-dialog__close"
            type="button"
            aria-label="Закрыть загрузку"
            onClick={onClose}
            disabled={pending}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <label
          className={`upload-dropzone ${dragActive ? "upload-dropzone--active" : ""} ${selectedFiles.length > 0 ? "upload-dropzone--selected" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            onDragActiveChange(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            onDragActiveChange(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              onDragActiveChange(false);
            }
          }}
          onDrop={onDrop}
        >
          <input
            className="visually-hidden"
            aria-label="Документы для Codex"
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            disabled={pending}
            onChange={(event) => onSelect(Array.from(event.currentTarget.files ?? []))}
          />
          <span className="upload-dropzone__icon" aria-hidden="true">
            <FileUp size={26} strokeWidth={1.7} />
          </span>
          {selectedFiles.length === 0 ? (
            <span className="upload-dropzone__copy">
              <strong>Перетащите файлы сюда</strong>
              <span>или нажмите, чтобы выбрать на диске</span>
            </span>
          ) : (
            <span className="upload-dropzone__copy">
              <strong>Выбрано {selectedFiles.length}</strong>
              <span>Можно добавить ещё — до 20 документов за раз</span>
            </span>
          )}
          <span className="upload-dropzone__formats">PDF · PNG · JPEG · до 5 МБ</span>
        </label>

        {selectedFiles.length > 0 ? (
          <ul className="upload-file-list" aria-label="Выбранные документы">
            {selectedFiles.map((file) => (
              <li key={`${file.name}:${file.size}:${file.lastModified}`}>
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  aria-label={`Убрать ${file.name}`}
                  onClick={() => onRemove(file)}
                  disabled={pending}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label className="codex-consent">
          <input
            type="checkbox"
            checked={codexConsent}
            onChange={(event) => onConsentChange(event.currentTarget.checked)}
            disabled={pending}
          />
          <span>
            Я согласен передать содержимое этих документов в Codex для классификации и извлечения.
            Исходные файлы остаются в локальном хранилище Veylta.
          </span>
        </label>

        <div className="synthetic-reminder" role="note">
          <strong>Не загружайте реальные медицинские данные.</strong>
          <span> Этот demo-контур предназначен только для вымышленных документов.</span>
        </div>

        {error !== null ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="upload-dialog__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={onClose}
            disabled={pending}
          >
            Отмена
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={pending || selectedFiles.length === 0 || !codexConsent}
          >
            {pending ? "Передаём документы…" : uploadButtonCopy(selectedFiles.length)}
          </button>
        </div>
        {pending ? (
          <p className="form-note" role="status">
            Сохраняем оригиналы, считаем SHA-256 и ставим анализ Codex в очередь…
          </p>
        ) : null}
      </form>
    </dialog>
  );
}

type ObservationHistoryItem = ObservationHistoryResponse["items"][number];

type ObservationHistoryState =
  | { kind: "loading" }
  | {
      kind: "ready";
      items: readonly ObservationHistoryItem[];
      nextCursor: string | null;
    }
  | { kind: "error"; copy: string };

interface ObservationHistoryPanelProps {
  familyId: string;
  profileId: string;
  canonicalCode?: string | undefined;
}

function observationHistoryRequestPath(
  familyId: string,
  profileId: string,
  canonicalCode?: string,
  cursor?: string,
): string {
  const parameters = new URLSearchParams();
  if (canonicalCode !== undefined && canonicalCode.length > 0) {
    parameters.set("canonicalCode", canonicalCode);
  }
  if (cursor !== undefined) parameters.set("cursor", cursor);
  const query = parameters.toString();
  return `${observationHistoryPath(familyId, profileId)}${query.length === 0 ? "" : `?${query}`}`;
}

interface ObservationDate {
  label: string;
  value: string;
}

function timelineDate(item: ObservationHistoryItem): ObservationDate {
  if (item.dates.sampledAt !== null) {
    return { label: "Дата биоматериала", value: item.dates.sampledAt };
  }
  if (item.dates.resultedAt !== null) {
    return { label: "Дата результата", value: item.dates.resultedAt };
  }
  return { label: "Дата загрузки", value: item.dates.uploadedAt };
}

function knownObservationDates(item: ObservationHistoryItem): readonly ObservationDate[] {
  return [
    item.dates.sampledAt === null
      ? null
      : { label: "Дата биоматериала", value: item.dates.sampledAt },
    item.dates.resultedAt === null
      ? null
      : { label: "Дата результата", value: item.dates.resultedAt },
    { label: "Дата загрузки", value: item.dates.uploadedAt },
  ].filter((date): date is ObservationDate => date !== null);
}

function observationHistoryErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "История этого профиля недоступна. Вернитесь к доступному профилю и попробуйте снова.";
  }
  return "Не удалось загрузить историю. Подтверждённые значения и исходные документы не изменены.";
}

function observationSourceHref(contentPath: string): string {
  return `${apiPrefix}${contentPath}`;
}

function ObservationHistoryPanel({
  familyId,
  profileId,
  canonicalCode,
}: ObservationHistoryPanelProps) {
  const [history, setHistory] = useState<ObservationHistoryState>({ kind: "loading" });
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setHistory({ kind: "loading" });
      setLoadMoreError(null);
      try {
        const response = await apiRequest<ObservationHistoryResponse>(
          observationHistoryRequestPath(familyId, profileId, canonicalCode),
          signal === undefined ? undefined : { signal },
        );
        if (signal?.aborted) return;
        setHistory({
          kind: "ready",
          items: response.items,
          nextCursor: response.nextCursor,
        });
      } catch (error) {
        if (!signal?.aborted)
          setHistory({ kind: "error", copy: observationHistoryErrorCopy(error) });
      }
    },
    [canonicalCode, familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadFirstPage(controller.signal);

    return () => {
      controller.abort();
      loadMoreController.current?.abort();
      loadMoreController.current = null;
    };
  }, [loadFirstPage]);

  async function loadNextPage(): Promise<void> {
    if (history.kind !== "ready" || history.nextCursor === null || loadMorePending) return;
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadMorePending(true);
    setLoadMoreError(null);
    try {
      const response = await apiRequest<ObservationHistoryResponse>(
        observationHistoryRequestPath(familyId, profileId, canonicalCode, history.nextCursor),
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setHistory((current) =>
        current.kind !== "ready"
          ? current
          : {
              kind: "ready",
              items: appendDistinctObservations(current.items, response.items),
              nextCursor: response.nextCursor,
            },
      );
    } catch (error) {
      if (!controller.signal.aborted) setLoadMoreError(observationHistoryErrorCopy(error));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setLoadMorePending(false);
      }
    }
  }

  return (
    <section
      id="observation-history"
      className="observation-history"
      aria-labelledby="observation-history-title"
      aria-busy={history.kind === "loading" || loadMorePending}
    >
      <div className="observation-history__heading">
        <p className="context-line">Подтверждённые наблюдения</p>
        <h2 id="observation-history-title">История подтверждённых значений</h2>
        <p>
          Здесь показаны только значения, которые пользователь явно подтвердил или исправил.
          Исходный фрагмент и ссылка на исходник остаются рядом с каждым значением. Тенденции и
          медицинские выводы не формируются.
        </p>
      </div>

      {history.kind === "loading" ? (
        <div className="observation-history__loading" aria-live="polite">
          <div className="skeleton skeleton--history-heading" aria-hidden="true" />
          <div className="skeleton skeleton--history-row" aria-hidden="true" />
          <p>Загружаем подтверждённые значения и их источники…</p>
        </div>
      ) : null}

      {history.kind === "error" ? (
        <div className="observation-history__empty" role="status">
          <p>{history.copy}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadFirstPage()}
          >
            Обновить историю
          </button>
        </div>
      ) : null}

      {history.kind === "ready" && history.items.length === 0 ? (
        <div className="observation-history__empty" role="status">
          <p>
            Пока нет подтверждённых значений. Откройте синтетический документ, сверьте его источник
            и явно подтвердите или исправьте нужный факт.
          </p>
        </div>
      ) : null}

      {history.kind === "ready" && history.items.length > 0 ? (
        <>
          <div className="observation-history__table-wrap">
            <table>
              <caption>Подтверждённые значения профиля в порядке даты источника</caption>
              <thead>
                <tr>
                  <th scope="col">Показатель</th>
                  <th scope="col">Значение как подтверждено</th>
                  <th scope="col">Дата</th>
                  <th scope="col">Источник</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => (
                  <ObservationHistoryRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>

          {history.nextCursor !== null ? (
            <div className="observation-history__more">
              <button
                className="button button--secondary"
                type="button"
                disabled={loadMorePending}
                onClick={() => void loadNextPage()}
              >
                {loadMorePending ? "Загружаем…" : "Показать следующие значения"}
              </button>
              {loadMoreError !== null ? (
                <p className="form-error" role="alert">
                  {loadMoreError}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function appendDistinctObservations(
  current: readonly ObservationHistoryItem[],
  incoming: readonly ObservationHistoryItem[],
): readonly ObservationHistoryItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

function ObservationHistoryRow({ item }: { item: ObservationHistoryItem }) {
  const date = timelineDate(item);
  const knownDates = knownObservationDates(item);
  const normalizedValue =
    item.normalized.value === null
      ? null
      : `${item.normalized.value}${item.normalized.unit === null ? "" : ` ${item.normalized.unit}`}`;
  const confidence = new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(item.extractionConfidence);

  return (
    <tr>
      <th scope="row">
        <span className="observation-history__name">{item.source.name}</span>
        {item.canonicalCode !== null ? (
          <span className="observation-history__code">{item.canonicalCode}</span>
        ) : null}
      </th>
      <td>
        <strong className="observation-history__value">
          {item.source.value} {item.source.unit}
        </strong>
        {normalizedValue !== null ? (
          <span className="observation-history__normalized">
            Нормализовано: {normalizedValue}
            {item.normalized.conversionVersion === null
              ? ""
              : ` · ${item.normalized.conversionVersion}`}
          </span>
        ) : null}
      </td>
      <td>
        <span className="observation-history__date-label">{date.label}</span>
        <time dateTime={date.value}>{formatDate(date.value)}</time>
      </td>
      <td>
        <details className="observation-history__provenance">
          <summary>Документ · страница {item.sourceDocument.pageNumber}</summary>
          <div className="observation-history__provenance-content">
            <dl>
              <div>
                <dt>Подтверждено</dt>
                <dd>
                  <time dateTime={item.confirmed.at}>{formatDate(item.confirmed.at)}</time>
                  {` · ${item.confirmed.by.displayName}`}
                </dd>
              </div>
              <div>
                <dt>Уверенность извлечения</dt>
                <dd>{confidence}</dd>
              </div>
              <div>
                <dt>Нормализованное значение</dt>
                <dd>{normalizedValue ?? "Не рассчитано"}</dd>
              </div>
              {knownDates.map((knownDate) => (
                <div key={knownDate.label}>
                  <dt>{knownDate.label}</dt>
                  <dd>
                    <time dateTime={knownDate.value}>{formatDate(knownDate.value)}</time>
                  </dd>
                </div>
              ))}
              {item.specimenType !== null ? (
                <div>
                  <dt>Материал</dt>
                  <dd>{item.specimenType}</dd>
                </div>
              ) : null}
              {item.laboratory !== null ? (
                <div>
                  <dt>Лаборатория</dt>
                  <dd>{item.laboratory}</dd>
                </div>
              ) : null}
              {item.referenceRange !== null ? (
                <>
                  <div>
                    <dt>Диапазон в документе</dt>
                    <dd>{referenceRangeCopy(item.referenceRange)}</dd>
                  </div>
                  {item.referenceRange.laboratoryOutOfRange !== null ? (
                    <div>
                      <dt>Отметка лаборатории</dt>
                      <dd>
                        {item.referenceRange.laboratoryOutOfRange
                          ? "Отмечено в исходном документе"
                          : "Не отмечено в исходном документе"}
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
            </dl>
            <p className="observation-history__fragment-label">Фрагмент из исходника</p>
            <pre className="observation-history__fragment">
              <code>{item.sourceDocument.fragment}</code>
            </pre>
            <a
              className="observation-history__source-link"
              href={observationSourceHref(item.sourceDocument.contentPath)}
              download
            >
              Открыть исходник
            </a>
          </div>
        </details>
      </td>
    </tr>
  );
}

type IndicatorCatalogItem = IndicatorCatalogResponse["items"][number];
type IndicatorCatalogState =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly IndicatorCatalogItem[] }
  | { kind: "error"; copy: string };

function indicatorCatalogErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "Показатели этого профиля недоступны. Вернитесь к доступному профилю и попробуйте снова.";
  }
  return "Не удалось загрузить каталог. Подтверждённые значения и исходные документы не изменены.";
}

function IndicatorCatalogPanel({
  familyId,
  profileId,
  canonicalCode,
}: ObservationHistoryPanelProps) {
  const [catalog, setCatalog] = useState<IndicatorCatalogState>({ kind: "loading" });
  const [selected, setSelected] = useState<{ canonicalCode: string; unit: string } | null>(null);

  const loadCatalog = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setCatalog({ kind: "loading" });
      try {
        const response = await apiRequest<IndicatorCatalogResponse>(
          indicatorsPath(familyId, profileId),
          signal === undefined ? undefined : { signal },
        );
        if (signal?.aborted) return;
        setCatalog({ kind: "ready", items: response.items });
        setSelected((current) => {
          if (
            current !== null &&
            response.items.some(
              (item) =>
                item.canonicalCode === current.canonicalCode &&
                item.units.some((unit) => unit.unit === current.unit),
            )
          ) {
            return current;
          }
          const first =
            response.items.find((item) => item.canonicalCode === canonicalCode) ??
            response.items[0];
          const firstUnit = first?.units[0];
          return first === undefined || firstUnit === undefined
            ? null
            : { canonicalCode: first.canonicalCode, unit: firstUnit.unit };
        });
      } catch (error) {
        if (!signal?.aborted) setCatalog({ kind: "error", copy: indicatorCatalogErrorCopy(error) });
      }
    },
    [canonicalCode, familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalog(controller.signal);
    return () => controller.abort();
  }, [loadCatalog]);

  return (
    <section
      id="indicator-catalog"
      className="indicator-catalog"
      aria-labelledby="indicator-catalog-title"
      aria-busy={catalog.kind === "loading"}
    >
      <div className="indicator-catalog__heading">
        <p className="context-line">Сопоставимые показатели</p>
        <h2 id="indicator-catalog-title">Подтверждённая динамика</h2>
        <p>
          Сравнение доступно только внутри одного кода и точно совпадающей единицы. Оно описывает
          изменение между источниками, но не даёт медицинской оценки.
        </p>
      </div>

      {catalog.kind === "loading" ? (
        <div className="indicator-catalog__loading" aria-live="polite">
          <div className="skeleton skeleton--indicator-heading" aria-hidden="true" />
          <div className="skeleton skeleton--indicator-row" aria-hidden="true" />
          <p>Готовим сопоставимые подтверждённые показатели…</p>
        </div>
      ) : null}

      {catalog.kind === "error" ? (
        <div className="indicator-catalog__empty" role="status">
          <p>{catalog.copy}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadCatalog()}
          >
            Обновить каталог
          </button>
        </div>
      ) : null}

      {catalog.kind === "ready" && catalog.items.length === 0 ? (
        <div className="indicator-catalog__empty" role="status">
          <p>
            Пока нет подтверждённых показателей с известным синтетическим кодом. Сначала подтвердите
            факт в источнике — он появится здесь без автоматической интерпретации.
          </p>
        </div>
      ) : null}

      {catalog.kind === "ready" && catalog.items.length > 0 ? (
        <div className="indicator-catalog__workspace">
          <ul className="indicator-catalog__list" aria-label="Показатели профиля">
            {catalog.items.flatMap((item) =>
              item.units.map((summary) => {
                const active =
                  selected?.canonicalCode === item.canonicalCode && selected.unit === summary.unit;
                return (
                  <li key={`${item.canonicalCode}:${summary.unit}`}>
                    <button
                      className="indicator-catalog__item"
                      data-active={active ? "true" : undefined}
                      type="button"
                      onClick={() =>
                        setSelected({ canonicalCode: item.canonicalCode, unit: summary.unit })
                      }
                    >
                      <span className="indicator-catalog__item-name">{item.displayName}</span>
                      <span className="indicator-catalog__item-latest">
                        {summary.latest.value} {summary.unit}
                      </span>
                      <span className="indicator-catalog__item-meta">
                        {summary.observationCount === 1
                          ? "1 подтверждённое значение"
                          : `${summary.observationCount} подтверждённых значения`}
                      </span>
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
          {selected !== null ? (
            <IndicatorSeriesPanel
              familyId={familyId}
              profileId={profileId}
              canonicalCode={selected.canonicalCode}
              unit={selected.unit}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type IndicatorSeriesState =
  | { kind: "loading" }
  | {
      kind: "ready";
      items: readonly IndicatorSeriesResponse["items"][number][];
      series: IndicatorSeriesResponse;
    }
  | { kind: "error"; copy: string };

function indicatorSeriesErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "Этот ряд больше недоступен для активного профиля.";
  }
  return "Не удалось загрузить ряд. Подтверждённые значения и исходные документы не изменены.";
}

function differenceCopy(comparison: IndicatorSeriesResponse["comparison"]): string {
  if (comparison.state === "insufficient_data") {
    return "Нужно хотя бы два подтверждённых значения в этой же единице, чтобы показать изменение.";
  }
  if (comparison.state === "unavailable") {
    return "Значения сохранены как источник, но их формат нельзя безопасно сравнить автоматически.";
  }
  const direction =
    comparison.delta.direction === "increased"
      ? "выше"
      : comparison.delta.direction === "decreased"
        ? "ниже"
        : "без изменения";
  return `Последнее значение ${direction} предыдущего на ${comparison.delta.value} в той же единице.`;
}

interface IndicatorChartPoint {
  item: IndicatorSeriesResponse["items"][number];
  value: number;
}

function indicatorChartPoints(
  items: readonly IndicatorSeriesResponse["items"][number][],
): readonly IndicatorChartPoint[] | null {
  const points = [...items].reverse().map((item) => {
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(item.source.value)) return null;
    const value = Number(item.source.value);
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
      ? { item, value }
      : null;
  });
  return points.some((point) => point === null) || points.length < 2
    ? null
    : (points as IndicatorChartPoint[]);
}

function IndicatorSeriesChart({
  points,
  unit,
}: {
  points: readonly IndicatorChartPoint[];
  unit: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const chartWidth = 560;
  const chartHeight = 220;
  const padding = 34;
  const values = points.map((point) => point.value);
  const lower = Math.min(...values);
  const upper = Math.max(...values);
  const range = upper - lower || 1;
  const positioned = points.map((point, index) => ({
    ...point,
    x: padding + (index / (points.length - 1)) * (chartWidth - padding * 2),
    y: chartHeight - padding - ((point.value - lower) / range) * (chartHeight - padding * 2),
  }));
  const polyline = positioned.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <figure className="indicator-series__chart">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>Расположение подтверждённых значений по времени</title>
        <desc id={descriptionId}>
          {points
            .map(
              (point) => `${formatDate(point.item.timelineAt)}: ${point.item.source.value} ${unit}`,
            )
            .join("; ")}
        </desc>
        <line x1={padding} y1={padding} x2={padding} y2={chartHeight - padding} />
        <line
          x1={padding}
          y1={chartHeight - padding}
          x2={chartWidth - padding}
          y2={chartHeight - padding}
        />
        <polyline points={polyline} />
        {positioned.map((point) => (
          <circle cx={point.x} cy={point.y} key={point.item.id} r="5">
            <title>
              {formatDate(point.item.timelineAt)}: {point.item.source.value} {unit}
            </title>
          </circle>
        ))}
        <text x={padding} y={padding - 10} textAnchor="start">
          {upper}
        </text>
        <text x={padding} y={chartHeight - 12} textAnchor="start">
          {lower}
        </text>
      </svg>
      <figcaption>
        Расположение точек помогает читать последовательность. Точные значения, даты и источники
        приведены ниже; шкала не означает референсный диапазон.
      </figcaption>
    </figure>
  );
}

function IndicatorSeriesPanel({
  familyId,
  profileId,
  canonicalCode,
  unit,
}: {
  familyId: string;
  profileId: string;
  canonicalCode: string;
  unit: string;
}) {
  const [state, setState] = useState<IndicatorSeriesState>({ kind: "loading" });
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const loadSeries = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState({ kind: "loading" });
      setLoadMoreError(null);
      try {
        const response = await apiRequest<IndicatorSeriesResponse>(
          `${indicatorsPath(familyId, profileId)}/${encodeURIComponent(canonicalCode)}?unit=${encodeURIComponent(unit)}`,
          signal === undefined ? undefined : { signal },
        );
        if (!signal?.aborted) setState({ kind: "ready", items: response.items, series: response });
      } catch (error) {
        if (!signal?.aborted) setState({ kind: "error", copy: indicatorSeriesErrorCopy(error) });
      }
    },
    [canonicalCode, familyId, profileId, unit],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSeries(controller.signal);
    return () => controller.abort();
  }, [loadSeries]);

  async function loadNextPage(): Promise<void> {
    if (state.kind !== "ready" || state.series.nextCursor === null || loadMorePending) return;
    setLoadMorePending(true);
    setLoadMoreError(null);
    try {
      const response = await apiRequest<IndicatorSeriesResponse>(
        `${indicatorsPath(familyId, profileId)}/${encodeURIComponent(canonicalCode)}?unit=${encodeURIComponent(unit)}&cursor=${encodeURIComponent(state.series.nextCursor)}`,
      );
      setState((current) =>
        current.kind !== "ready"
          ? current
          : { kind: "ready", items: [...current.items, ...response.items], series: response },
      );
    } catch (error) {
      setLoadMoreError(indicatorSeriesErrorCopy(error));
    } finally {
      setLoadMorePending(false);
    }
  }

  const chartPoints = useMemo(
    () => (state.kind === "ready" ? indicatorChartPoints(state.items) : null),
    [state],
  );

  if (state.kind === "loading") {
    return (
      <div className="indicator-series indicator-series--loading" aria-live="polite">
        <div className="skeleton skeleton--indicator-plot" aria-hidden="true" />
        <p>Загружаем ряд источников…</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="indicator-series indicator-series--empty" role="status">
        <p>{state.copy}</p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void loadSeries()}
        >
          Повторить
        </button>
      </div>
    );
  }

  const chronological = [...state.items].reverse();
  return (
    <div className="indicator-series" aria-live="polite">
      <div className="indicator-series__title">
        <div>
          <h3>{state.series.indicator.displayName}</h3>
          <p>
            {state.series.indicator.canonicalCode} · {state.series.indicator.unit}
          </p>
        </div>
        <strong>{state.items.length} источника</strong>
      </div>
      <p className="indicator-series__comparison">{differenceCopy(state.series.comparison)}</p>
      {chartPoints === null ? null : (
        <IndicatorSeriesChart points={chartPoints} unit={state.series.indicator.unit} />
      )}
      <ol className="indicator-series__timeline" aria-label="Подтверждённые значения по времени">
        {chronological.map((item) => (
          <li key={item.id}>
            <div>
              <strong>
                {item.source.value} {item.source.unit}
              </strong>
              <time dateTime={item.timelineAt}>{formatDate(item.timelineAt)}</time>
            </div>
            <a href={observationSourceHref(item.sourceDocument.contentPath)}>Источник</a>
          </li>
        ))}
      </ol>
      {state.series.nextCursor === null ? null : (
        <div className="indicator-series__more">
          <button
            className="button button--secondary"
            type="button"
            disabled={loadMorePending}
            onClick={() => void loadNextPage()}
          >
            {loadMorePending ? "Загружаем…" : "Показать следующие значения"}
          </button>
          {loadMoreError === null ? null : (
            <p className="form-error" role="alert">
              {loadMoreError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type DocumentViewState =
  | { kind: "loading" }
  | { kind: "ready"; document: DocumentDetail }
  | { kind: "missing" }
  | { kind: "error" };

interface DocumentViewProps {
  family: SessionFamily;
  profile: PatientProfileSummary;
  documentId: string;
  canWriteProfile: boolean;
}

function DocumentView({ family, profile, documentId, canWriteProfile }: DocumentViewProps) {
  const [state, setState] = useState<DocumentViewState>({ kind: "loading" });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [suggestedAgentMessage, setSuggestedAgentMessage] = useState<{
    id: string;
    prompt: string;
  } | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const deleteKey = useRef<string | null>(null);
  const restartKey = useRef<string | null>(null);
  const refreshedTerminalProcessing = useRef<string | null>(null);
  const previousDocumentId = useRef(documentId);
  const router = useRouter();
  const endpoint = `/v1/families/${encodeURIComponent(family.id)}/profiles/${encodeURIComponent(profile.id)}/documents/${encodeURIComponent(documentId)}`;

  const handleProcessingChange = useCallback((processing: DocumentProcessingStatus) => {
    setState((current) => {
      if (current.kind !== "ready") return current;
      if (processingStatusesEqual(current.document.processing, processing)) return current;
      return {
        kind: "ready",
        document: { ...current.document, processing },
      };
    });
  }, []);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    apiRequest<DocumentDetailResponse>(endpoint)
      .then((response) => {
        if (active) setState({ kind: "ready", document: response.document });
      })
      .catch((error) => {
        if (!active) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { kind: "missing" }
            : { kind: "error" },
        );
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  const terminalProcessingVersion =
    state.kind === "ready" &&
    (state.document.processing.state === "awaiting_review" ||
      state.document.processing.state === "completed")
      ? `${state.document.processing.state}:${state.document.processing.updatedAt}`
      : null;

  useEffect(() => {
    if (
      terminalProcessingVersion === null ||
      refreshedTerminalProcessing.current === terminalProcessingVersion
    ) {
      return;
    }
    let active = true;
    refreshedTerminalProcessing.current = terminalProcessingVersion;
    void apiRequest<DocumentDetailResponse>(endpoint)
      .then((response) => {
        if (active) setState({ kind: "ready", document: response.document });
      })
      .catch(() => {
        if (active) refreshedTerminalProcessing.current = null;
      });
    return () => {
      active = false;
    };
  }, [endpoint, terminalProcessingVersion]);

  useEffect(() => {
    if (previousDocumentId.current === documentId) return;
    previousDocumentId.current = documentId;
    setDeleteDialogOpen(false);
    setDeleteError(null);
    setRestartError(null);
    deleteKey.current = null;
    restartKey.current = null;
    refreshedTerminalProcessing.current = null;
  }, [documentId]);

  const title =
    state.kind === "ready"
      ? `${state.document.originalFilename} — ${profile.displayName} — Veylta`
      : `${profile.displayName} — Veylta`;
  useEffect(() => {
    document.title = title;
  }, [title]);

  if (state.kind === "loading") {
    return (
      <section className="document-view" aria-live="polite" aria-busy="true">
        <p className="context-line">Открываем документ</p>
        <div className="skeleton skeleton--document-title" aria-hidden="true" />
        <div className="skeleton skeleton--copy" aria-hidden="true" />
      </section>
    );
  }

  if (state.kind === "missing") {
    return (
      <section className="document-view" aria-labelledby="missing-document-title">
        <p className="context-line">Доступ ограничен</p>
        <h2 id="missing-document-title">Документ недоступен</h2>
        <p className="document-intro">
          Документа нет или у этой сессии нет к нему доступа. Дополнительные сведения не
          раскрываются.
        </p>
        <Link
          className="button button--secondary"
          href={profileTabPath(family.id, profile.id, "documents")}
        >
          Вернуться в профиль
        </Link>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="document-view" aria-labelledby="document-error-title">
        <p className="context-line">Соединение прервано</p>
        <h2 id="document-error-title">Статус документа не загрузился</h2>
        <p className="document-intro">Исходник не изменился. Обновите страницу, чтобы повторить.</p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => location.reload()}
        >
          Обновить страницу
        </button>
      </section>
    );
  }

  const { document: savedDocument } = state;
  const contentUrl = `${apiPrefix}${endpoint}/content`;
  const intelligence = savedDocument.intelligence;
  const results = intelligence?.structuredResults ?? [];
  const processing = savedDocument.processing;
  const terminalFactCount = isReviewAvailable(processing) ? processing.factCount : 0;
  const resultAvailability = documentResultAvailabilityCopy(results.length, terminalFactCount);
  const canRestart =
    canWriteProfile &&
    (processing.state === "failed" ||
      processing.state === "awaiting_review" ||
      processing.state === "completed");

  async function handleRestart(): Promise<void> {
    if (state.kind !== "ready") return;
    setRestartPending(true);
    setRestartError(null);
    const commandKey = restartKey.current ?? crypto.randomUUID();
    restartKey.current = commandKey;
    try {
      const response = await apiRequest<DocumentProcessingRestartResponse>(
        `${documentProcessingPath(family.id, profile.id, savedDocument.id)}/restart`,
        { method: "POST", headers: { "Idempotency-Key": commandKey } },
      );
      setState({
        kind: "ready",
        document: { ...savedDocument, processing: response.processing },
      });
      restartKey.current = null;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) restartKey.current = null;
      setRestartError("Не удалось запустить новый разбор. Предыдущий результат сохранён.");
    } finally {
      setRestartPending(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setDeletePending(true);
    setDeleteError(null);
    const commandKey = deleteKey.current ?? crypto.randomUUID();
    deleteKey.current = commandKey;
    try {
      await apiRequest<DocumentDeleteResponse>(endpoint, {
        method: "DELETE",
        headers: { "Idempotency-Key": commandKey },
      });
      deleteKey.current = null;
      router.push(profileTabPath(family.id, profile.id, "documents"));
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) deleteKey.current = null;
      setDeleteError("Не удалось удалить документ из активного архива. Ничего не изменилось.");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <section className="document-view" aria-labelledby="document-title">
      <DocumentHero
        title={intelligence?.title ?? savedDocument.originalFilename}
        metadata={`${documentKindLabel(savedDocument.contentType)} · ${formatBytes(savedDocument.byteSize)} · ${formatDate(savedDocument.uploadedAt)}`}
        summary={
          intelligence?.shortSummary ??
          "Короткое саммари появится здесь после завершения нового разбора документа."
        }
        resultAvailability={isReviewAvailable(processing) ? resultAvailability : null}
        downloadHref={contentUrl}
        canRestart={canRestart}
        restartPending={restartPending}
        restartError={restartError}
        canDelete={canWriteProfile}
        onRestart={() => void handleRestart()}
        onDelete={() => setDeleteDialogOpen(true)}
      />

      {savedDocument.duplicate.possible ? (
        <div className="duplicate-note" role="status">
          <strong>Такой исходник уже встречался</strong>
          <p>Контрольная сумма совпадает с документом этой семьи.</p>
        </div>
      ) : null}

      <div className="document-dashboard-grid">
        <div className="document-dashboard-grid__main">
          <DocumentReviewPanel
            key={`${family.id}:${profile.id}:${savedDocument.id}`}
            familyId={family.id}
            profileId={profile.id}
            documentId={savedDocument.id}
            results={results}
            processing={processing}
            contentUrl={contentUrl}
            canWriteProfile={canWriteProfile}
            onReviewSaved={() => setReviewRevision((current) => current + 1)}
            onAskCodex={(prompt) => setSuggestedAgentMessage({ id: crypto.randomUUID(), prompt })}
          />

          <ClinicianRecordsPanel
            familyId={family.id}
            profileId={profile.id}
            documentId={savedDocument.id}
            contentUrl={contentUrl}
            canWrite={canWriteProfile}
            refreshKey={
              processing.state === "not_started"
                ? processing.state
                : `${processing.state}:${processing.updatedAt}`
            }
          />

          <section className="document-detailed-summary" aria-labelledby="document-detail-title">
            <div className="document-section-heading">
              <div>
                <p className="context-line">Подробно</p>
                <h3 id="document-detail-title">Развёрнутое саммари</h3>
              </div>
            </div>
            <p>
              {intelligence?.detailedSummary ??
                "Развёрнутое саммари появится после завершения нового разбора документа."}
            </p>
          </section>
        </div>

        <aside className="document-dashboard-grid__rail" aria-label="Сведения об источнике">
          <section className="document-rail-card">
            <div className="document-rail-card__title">
              <FileText size={18} aria-hidden="true" />
              <h3>Исходник</h3>
            </div>
            <dl>
              <div>
                <dt>Файл</dt>
                <dd>{savedDocument.originalFilename}</dd>
              </div>
              <div>
                <dt>Формат</dt>
                <dd>{documentKindLabel(savedDocument.contentType)}</dd>
              </div>
              <div>
                <dt>Размер</dt>
                <dd>{formatBytes(savedDocument.byteSize)}</dd>
              </div>
              <div>
                <dt>Загружен</dt>
                <dd>{formatDate(savedDocument.uploadedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="document-rail-card">
            <div className="document-rail-card__title">
              <Bot size={18} aria-hidden="true" />
              <h3>Классификация</h3>
            </div>
            {intelligence === null ? (
              <p className="document-rail-card__empty">Codex ещё распределяет документ.</p>
            ) : (
              <dl>
                <div>
                  <dt>Раздел</dt>
                  <dd>{documentCategoryLabels[intelligence.category]}</dd>
                </div>
                <div>
                  <dt>Дата документа</dt>
                  <dd>{intelligence.documentDate ?? "Не указана"}</dd>
                </div>
                <div>
                  <dt>Модель</dt>
                  <dd>{intelligence.modelId}</dd>
                </div>
                <div>
                  <dt>Уверенность</dt>
                  <dd>{Math.round(intelligence.confidence * 100)}%</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="document-rail-card document-rail-card--integrity">
            <div className="document-rail-card__title">
              <ShieldCheck size={18} aria-hidden="true" />
              <h3>Целостность</h3>
            </div>
            <p>Оригинальные байты сверяются перед каждой обработкой.</p>
            <details>
              <summary>Показать SHA-256</summary>
              <code>{savedDocument.sha256}</code>
            </details>
          </section>
        </aside>
      </div>

      <DocumentProcessingPanel
        familyId={family.id}
        profileId={profile.id}
        document={savedDocument}
        canWriteProfile={canWriteProfile}
        onProcessingChange={handleProcessingChange}
        reviewRevision={reviewRevision}
        suggestedAgentMessage={suggestedAgentMessage}
      />

      {deleteDialogOpen ? (
        <div
          className="document-delete-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="document-delete-title"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !deletePending) setDeleteDialogOpen(false);
          }}
        >
          <button
            className="document-delete-dialog__backdrop"
            type="button"
            aria-label="Закрыть подтверждение удаления"
            onClick={() => {
              if (!deletePending) setDeleteDialogOpen(false);
            }}
          />
          <div className="document-delete-dialog__panel">
            <span className="document-delete-dialog__icon" aria-hidden="true">
              <Trash2 size={22} />
            </span>
            <p className="context-line">Необратимо для активного архива</p>
            <h3 id="document-delete-title">Удалить документ из Veylta?</h3>
            <p>
              Он исчезнет из активного архива и поиска. Уже подтверждённые записи и их происхождение
              останутся в истории для целостности журнала.
            </p>
            {deleteError === null ? null : (
              <p className="form-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="document-delete-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={deletePending}
                onClick={() => setDeleteDialogOpen(false)}
              >
                Отмена
              </button>
              <button
                className="button button--danger"
                type="button"
                disabled={deletePending}
                onClick={() => void handleDelete()}
              >
                {deletePending ? "Удаляем…" : "Удалить документ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface DocumentProcessingPanelProps {
  familyId: string;
  profileId: string;
  document: DocumentSummary;
  canWriteProfile: boolean;
  onProcessingChange?: (processing: DocumentProcessingStatus) => void;
  reviewRevision: number;
  suggestedAgentMessage: { id: string; prompt: string } | null;
}

interface ProcessingPresentation {
  heading: string;
  copy: string;
  integrityLabel: string;
  mark: "—" | "…" | "!" | "✓";
  tone: "idle" | "active" | "attention" | "complete" | "failed";
}

function processingStatusesEqual(
  current: DocumentProcessingStatus,
  next: DocumentProcessingStatus,
): boolean {
  if (current.state !== next.state) return false;

  switch (current.state) {
    case "not_started":
      return true;
    case "queued":
    case "security_check":
    case "text_extraction":
    case "document_classification":
    case "structured_extraction":
    case "validation":
      return "updatedAt" in next && current.updatedAt === next.updatedAt;
    case "awaiting_review":
      return (
        next.state === "awaiting_review" &&
        current.updatedAt === next.updatedAt &&
        current.factCount === next.factCount &&
        current.needsReviewCount === next.needsReviewCount
      );
    case "completed":
      return (
        next.state === "completed" &&
        current.updatedAt === next.updatedAt &&
        current.factCount === next.factCount
      );
    case "failed":
      return (
        next.state === "failed" &&
        current.updatedAt === next.updatedAt &&
        current.category === next.category &&
        current.retryAllowed === next.retryAllowed
      );
  }
}

function documentKindLabel(contentType: DocumentSummary["contentType"]): string {
  switch (contentType) {
    case "application/pdf":
      return "PDF";
    case "image/png":
      return "PNG";
    case "image/jpeg":
      return "JPEG";
  }
}

function processingFailureCopy(
  status: Extract<DocumentProcessingStatus, { state: "failed" }>,
): string {
  switch (status.category) {
    case "document_unavailable":
      return "Исходник сейчас недоступен обработчику. Сам файл не менялся.";
    case "invalid_document":
      return "Документ нельзя обработать безопасно. Исходник сохранён без изменений.";
    case "agent_unavailable":
      return "Codex сейчас недоступен. Исходник сохранён локально, можно повторить анализ позже.";
    case "agent_output_invalid":
      return "Ответ Codex не прошёл проверку структуры и привязки к источнику.";
    case "extraction_failed":
      return "Не удалось надёжно извлечь текст. Никаких значений не интерпретировано.";
    case "validation_failed":
      return "Черновой результат не прошёл проверку источника и структуры.";
    case "attempts_exhausted":
      return "Автоматические попытки закончились. Никаких значений не подтверждено.";
  }
}

function processingPresentation(status: DocumentProcessingStatus): ProcessingPresentation {
  switch (status.state) {
    case "not_started":
      return {
        heading: "Извлечение ещё не поставлено в очередь",
        copy: "Исходник сохранён без изменений. Статус появится после следующего обновления.",
        integrityLabel: "Не поставлено в очередь",
        mark: "—",
        tone: "idle",
      };
    case "queued":
      return {
        heading: "Документ ожидает обработки",
        copy: "Локальная очередь приняла задачу. Обновляем статус автоматически.",
        integrityLabel: "В очереди",
        mark: "…",
        tone: "active",
      };
    case "security_check":
      return {
        heading: "Проверяем документ",
        copy: "Проверяем доступность и целостность сохранённого исходника.",
        integrityLabel: "Проверка документа",
        mark: "…",
        tone: "active",
      };
    case "text_extraction":
      return {
        heading: "Извлекаем текст из исходника",
        copy: "Локально получаем текст или изображение, которые затем будут переданы выбранному AI-провайдеру.",
        integrityLabel: "Извлечение текста",
        mark: "…",
        tone: "active",
      };
    case "document_classification":
      return {
        heading: "Codex определяет тип документа",
        copy: "AI выбирает раздел архива и короткое понятное название документа.",
        integrityLabel: "Классификация Codex",
        mark: "…",
        tone: "active",
      };
    case "structured_extraction":
      return {
        heading: "Codex разбирает документ",
        copy: "Каждое найденное значение должно быть связано со страницей и точным фрагментом исходника.",
        integrityLabel: "Структурирование",
        mark: "…",
        tone: "active",
      };
    case "validation":
      return {
        heading: "Проверяем ответ Codex",
        copy: "Отбрасываем результат, если структура или ссылка на источник не проходят строгую проверку.",
        integrityLabel: "Проверка результата",
        mark: "…",
        tone: "active",
      };
    case "awaiting_review":
      return {
        heading: "Черновые значения ждут проверки",
        copy: `Найдено ${archiveValueCountCopy(status.factCount)}; ${archiveValueCountCopy(status.needsReviewCount)} ${pluralForm(status.needsReviewCount, ["требует", "требуют", "требуют"])} дополнительного внимания. Ничего не подтверждено автоматически.`,
        integrityLabel: "Ожидает проверки",
        mark: "!",
        tone: "attention",
      };
    case "completed":
      return {
        heading: "Извлечение завершено",
        copy: `Сохранено ${archiveValueCountCopy(status.factCount)} для последующей проверки вместе с источником. Ничего не интерпретировано автоматически.`,
        integrityLabel: "Завершено",
        mark: "✓",
        tone: "complete",
      };
    case "failed":
      return {
        heading: "Извлечение не завершилось",
        copy: processingFailureCopy(status),
        integrityLabel: "Не завершено",
        mark: "!",
        tone: "failed",
      };
  }
}

function DocumentProcessingPanel({
  familyId,
  profileId,
  document: savedDocument,
  canWriteProfile,
  onProcessingChange,
  reviewRevision,
  suggestedAgentMessage,
}: DocumentProcessingPanelProps) {
  const [processing, setProcessing] = useState<DocumentProcessingStatus>(savedDocument.processing);
  const [activity, setActivity] = useState<readonly DocumentProcessingActivityEvent[]>([]);
  const [refreshFailed, setRefreshFailed] = useState(false);
  /**
   * A pin belongs to the document it was made on, so switching documents drops it without
   * an effect. A null run id follows the newest run; a status refresh never clears the pin.
   */
  const [pinnedRun, setPinnedRun] = useState<{ documentId: string; runId: string | null }>({
    documentId: savedDocument.id,
    runId: null,
  });
  const selectedRunId = pinnedRun.documentId === savedDocument.id ? pinnedRun.runId : null;
  const [activityRunId, setActivityRunId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DocumentProcessingRunDiagnostics | null>(null);

  const refreshProcessing = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await apiRequest<DocumentProcessingResponse>(
          documentProcessingPath(familyId, profileId, savedDocument.id, selectedRunId),
          signal === undefined ? undefined : { signal },
        );
        if (signal?.aborted) return;
        setRefreshFailed(false);
        setProcessing((current) =>
          processingStatusesEqual(current, response.processing) ? current : response.processing,
        );
        onProcessingChange?.(response.processing);
        setActivity(response.activity);
        setActivityRunId(response.activityRunId);
        // A stub or an older server may omit diagnostics; the panel expects null, not undefined.
        setDiagnostics(response.diagnostics ?? null);
      } catch {
        if (!signal?.aborted) setRefreshFailed(true);
      }
    },
    [familyId, onProcessingChange, profileId, savedDocument.id, selectedRunId],
  );

  const selectRun = useCallback(
    (runId: string | null) => setPinnedRun({ documentId: savedDocument.id, runId }),
    [savedDocument.id],
  );

  useEffect(() => {
    setProcessing(savedDocument.processing);
    setRefreshFailed(false);
    setActivity([]);
  }, [savedDocument.processing]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshProcessing(controller.signal);
    if (!isProcessingActive(processing)) {
      return () => {
        controller.abort();
      };
    }

    const interval = window.setInterval(() => {
      void refreshProcessing(controller.signal);
    }, processingPollIntervalMs);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [processing, refreshProcessing]);

  useEffect(() => {
    if (reviewRevision > 0) void refreshProcessing();
  }, [refreshProcessing, reviewRevision]);

  const presentation = processingPresentation(processing);

  return (
    <div className="document-processing-dashboard">
      <section
        className={`processing-state processing-state--${presentation.tone}`}
        aria-labelledby="processing-title"
        aria-busy={isProcessingActive(processing)}
      >
        <div className="processing-state__mark" aria-hidden="true">
          {presentation.mark}
        </div>
        <div className="processing-state__content">
          <h3 id="processing-title">{presentation.heading}</h3>
          <p role="status">{presentation.copy}</p>
          {"updatedAt" in processing ? (
            <p className="processing-state__updated">
              Статус обновлён{" "}
              <time dateTime={processing.updatedAt}>{formatDate(processing.updatedAt)}</time>
            </p>
          ) : null}
          {refreshFailed ? (
            <p className="processing-state__refresh-note" role="status">
              Не удалось обновить статус. Исходник не изменён.
            </p>
          ) : null}
        </div>
      </section>

      {canWriteProfile ? (
        <DocumentAgentPanel
          familyId={familyId}
          profileId={profileId}
          documentId={savedDocument.id}
          documentName={savedDocument.originalFilename}
          documentUploadedAt={savedDocument.uploadedAt}
          workspaceRefreshKey={
            processing.state === "not_started"
              ? processing.state
              : `${processing.state}:${processing.updatedAt}`
          }
          suggestedMessage={suggestedAgentMessage}
          selectedRunId={selectedRunId}
          activityRunId={activityRunId}
          activity={activity}
          diagnostics={diagnostics}
          onSelectRun={selectRun}
        />
      ) : null}
    </div>
  );
}

type ReviewFactStatus = ExtractedFactReviewStatus;
type ReviewFact = DocumentFactsResponse["items"][number];

type FactListState =
  | { kind: "loading" }
  | {
      kind: "ready";
      items: readonly ReviewFact[];
      extractionRunId: string;
      extractorVersion: string;
    }
  | { kind: "error" };

type ReviewCommand = FactReviewCommand;
type ConfirmedCorrection = NonNullable<ReviewCommand["correction"]>;

interface ReviewCommandAttempt {
  readonly fingerprint: string;
  readonly key: string;
}

type BulkReviewState =
  | { kind: "idle" }
  | { kind: "running"; completed: number; total: number }
  | { kind: "success"; total: number }
  | { kind: "error"; completed: number; total: number };

function isPendingReview(status: ReviewFactStatus): boolean {
  return status === "extracted" || status === "needs_review";
}

const reviewBlockingIssues: ReadonlySet<string> = new Set(REVIEW_BLOCKING_VALIDATION_ISSUES);

/** Mirrors the API's review-status rule: only a doubtful reading needs a hand on it. */
export function canBulkConfirmFact(fact: {
  readonly reviewStatus: ExtractedFactReviewStatus;
  readonly validationIssues: readonly string[];
}): boolean {
  return (
    fact.reviewStatus === "extracted" &&
    !fact.validationIssues.some((issue) => reviewBlockingIssues.has(issue))
  );
}

export function documentResultAvailabilityCopy(
  structuredResultCount: number,
  extractedFactCount: number,
): string | null {
  return structuredResultCount === 0 && extractedFactCount === 0
    ? "Структурированных результатов нет"
    : null;
}

export function documentResultMatchesFact(
  result: {
    readonly resultKey: string;
    readonly type: DocumentIntelligenceStructuredResult["type"];
    readonly value: string | null;
    readonly unit: string | null;
    readonly source: { readonly pageNumber: number; readonly fragment: string };
  },
  fact: {
    readonly factKey: string;
    readonly sourceValue: string;
    readonly sourceUnit: string;
    readonly source: { readonly pageNumber: number; readonly fragment: string };
  },
): boolean {
  if (
    result.type !== "measurement" ||
    result.value !== fact.sourceValue ||
    (result.unit ?? "") !== fact.sourceUnit ||
    result.source.pageNumber !== fact.source.pageNumber
  ) {
    return false;
  }
  return (
    fact.source.fragment.includes(result.source.fragment) ||
    result.source.fragment.includes(fact.source.fragment)
  );
}

function reviewStatusLabel(status: ReviewFactStatus): string {
  switch (status) {
    case "extracted":
      return "Готово к подтверждению";
    case "needs_review":
      return "Нужна отдельная проверка";
    case "confirmed":
      return "Подтверждено пользователем";
    case "rejected":
      return "Отклонено пользователем";
  }
}

function reviewStatusDescription(status: ReviewFactStatus): string {
  switch (status) {
    case "extracted":
      return "Замечаний извлечения нет, но решение всё равно принимает человек.";
    case "needs_review":
      return "Есть неопределённость: сверьте источник и примите решение отдельно.";
    case "confirmed":
      return "Значение подтверждено пользователем с сохранённой ссылкой на источник.";
    case "rejected":
      return "Извлечение сохранено как источник, но не стало подтверждённым значением.";
  }
}

function reviewIssueLabel(issue: string): string {
  switch (issue) {
    case "LOW_CONFIDENCE":
      return "Низкая уверенность";
    case "AMBIGUOUS_UNIT":
      return "Неоднозначная единица";
    case "MISSING_UNIT":
      return "Не указана единица";
    case "INVALID_VALUE":
      return "Значение требует проверки";
    case "INVALID_REFERENCE_RANGE":
      return "Диапазон требует проверки";
    default:
      return "Требуется проверка";
  }
}

function proposedValue(value: string | null): string {
  return value ?? "Не предложено";
}

function reviewErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "Версия извлечения уже изменилась. Обновите список и проверьте источник ещё раз.";
  }
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "Этот документ больше недоступен в активном профиле. Обновите страницу.";
  }
  return "Не удалось сохранить решение. Исходное извлечение не изменилось.";
}

interface DocumentReviewPanelProps {
  familyId: string;
  profileId: string;
  documentId: string;
  results: readonly DocumentIntelligenceStructuredResult[];
  processing: DocumentProcessingStatus;
  contentUrl: string;
  canWriteProfile: boolean;
  onReviewSaved: () => void;
  onAskCodex: (prompt: string) => void;
}

function DocumentReviewPanel({
  familyId,
  profileId,
  documentId,
  results,
  processing,
  contentUrl,
  canWriteProfile,
  onReviewSaved,
  onAskCodex,
}: DocumentReviewPanelProps) {
  const [facts, setFacts] = useState<FactListState>({ kind: "loading" });
  const [pendingFactId, setPendingFactId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<{ factId: string; copy: string } | null>(null);
  const [reviewNotice, setReviewNotice] = useState<{ factId: string; copy: string } | null>(null);
  const [correctionFactId, setCorrectionFactId] = useState<string | null>(null);
  const [confirmedCorrections, setConfirmedCorrections] = useState<
    ReadonlyMap<string, ConfirmedCorrection>
  >(() => new Map());
  const [bulkReview, setBulkReview] = useState<BulkReviewState>({ kind: "idle" });
  const [selectedResultKey, setSelectedResultKey] = useState<string | null>(null);
  const commandAttempts = useRef<Map<string, ReviewCommandAttempt>>(new Map());

  const loadFacts = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const init = signal === undefined ? undefined : { signal };
        const response = await apiRequest<DocumentFactsResponse>(
          documentFactsPath(familyId, profileId, documentId),
          init,
        );
        if (signal?.aborted) return;
        setFacts({
          kind: "ready",
          items: response.items,
          extractionRunId: response.extractionRunId,
          extractorVersion: response.extractorVersion,
        });
      } catch {
        if (!signal?.aborted) setFacts({ kind: "error" });
      }
    },
    [documentId, familyId, profileId],
  );

  // Keyed on review availability, not on every processing state: awaiting_review → completed is
  // the reviewer's own last decision, and must not throw away the selection and notice.
  const reviewAvailable = isReviewAvailable(processing);
  useEffect(() => {
    const controller = new AbortController();
    setFacts({ kind: "loading" });
    setPendingFactId(null);
    setReviewError(null);
    setReviewNotice(null);
    setCorrectionFactId(null);
    setConfirmedCorrections(new Map());
    setBulkReview({ kind: "idle" });
    setSelectedResultKey(null);
    commandAttempts.current.clear();
    if (reviewAvailable) {
      void loadFacts(controller.signal);
    }

    return () => {
      controller.abort();
    };
  }, [loadFacts, reviewAvailable]);

  async function persistDecision(fact: ReviewFact, command: ReviewCommand): Promise<void> {
    const fingerprint = JSON.stringify(command);
    const previousAttempt = commandAttempts.current.get(fact.id);
    const attempt =
      previousAttempt?.fingerprint === fingerprint
        ? previousAttempt
        : { fingerprint, key: crypto.randomUUID() };
    commandAttempts.current.set(fact.id, attempt);
    try {
      await apiRequest<FactReviewResponse>(
        `${documentFactsPath(familyId, profileId, documentId)}/${encodeURIComponent(fact.id)}/review`,
        {
          method: "POST",
          headers: { "Idempotency-Key": attempt.key },
          body: JSON.stringify(command),
        },
      );
      commandAttempts.current.delete(fact.id);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        commandAttempts.current.delete(fact.id);
      }
      throw error;
    }
  }

  function updateFactStatus(factId: string, status: ReviewFactStatus): void {
    setFacts((current) =>
      current.kind !== "ready"
        ? current
        : {
            kind: "ready",
            items: current.items.map((item) =>
              item.id === factId ? { ...item, reviewStatus: status } : item,
            ),
            extractionRunId: current.extractionRunId,
            extractorVersion: current.extractorVersion,
          },
    );
  }

  async function submitDecision(fact: ReviewFact, command: ReviewCommand): Promise<void> {
    setPendingFactId(fact.id);
    setReviewError(null);
    setReviewNotice(null);
    setBulkReview({ kind: "idle" });

    try {
      await persistDecision(fact, command);
      const nextStatus: ReviewFactStatus = command.decision === "reject" ? "rejected" : "confirmed";
      updateFactStatus(fact.id, nextStatus);
      const confirmedCorrection =
        command.decision === "correct" && command.correction !== undefined
          ? command.correction
          : null;
      if (confirmedCorrection !== null) {
        setConfirmedCorrections((current) => new Map(current).set(fact.id, confirmedCorrection));
      }
      setCorrectionFactId(null);
      setReviewNotice({
        factId: fact.id,
        copy:
          command.decision === "reject"
            ? "Отклонено пользователем"
            : command.decision === "correct"
              ? "Исправлено и подтверждено"
              : "Подтверждено пользователем",
      });
      const nextPending =
        facts.kind === "ready"
          ? facts.items.find(
              (candidate) => candidate.id !== fact.id && isPendingReview(candidate.reviewStatus),
            )
          : undefined;
      if (nextPending !== undefined) setSelectedResultKey(nextPending.factKey);
      onReviewSaved();
      void loadFacts();
    } catch (error) {
      setReviewError({ factId: fact.id, copy: reviewErrorCopy(error) });
    } finally {
      setPendingFactId(null);
    }
  }

  async function confirmAll(pendingFacts: readonly ReviewFact[]): Promise<void> {
    const total = pendingFacts.length;
    if (total === 0) return;

    setReviewError(null);
    setReviewNotice(null);
    setCorrectionFactId(null);
    setBulkReview({ kind: "running", completed: 0, total });

    let completed = 0;
    for (const fact of pendingFacts) {
      try {
        await persistDecision(fact, {
          factVersion: fact.factVersion,
          decision: "confirm",
        });
        completed += 1;
        updateFactStatus(fact.id, "confirmed");
        setBulkReview({ kind: "running", completed, total });
      } catch {
        setBulkReview({ kind: "error", completed, total });
        if (completed > 0) onReviewSaved();
        void loadFacts();
        return;
      }
    }

    setBulkReview({ kind: "success", total });
    onReviewSaved();
    void loadFacts();
  }

  const pendingFacts =
    facts.kind === "ready" ? facts.items.filter((fact) => isPendingReview(fact.reviewStatus)) : [];
  const bulkConfirmableFacts = pendingFacts.filter(canBulkConfirmFact);
  const individualReviewCount = pendingFacts.length - bulkConfirmableFacts.length;
  const reviewPending = pendingFactId !== null || bulkReview.kind === "running";
  const factItems = facts.kind === "ready" ? facts.items : [];
  const pairedFactIds = new Set<string>();
  const resultRows = prioritizeDocumentResults(results).map((result) => {
    const fact = factItems.find(
      (candidate) =>
        !pairedFactIds.has(candidate.id) && documentResultMatchesFact(result, candidate),
    );
    if (fact !== undefined) pairedFactIds.add(fact.id);
    return {
      key: fact?.factKey ?? `result:${result.resultKey}`,
      result,
      fact: fact ?? null,
    };
  });
  const rows: readonly {
    key: string;
    result: DocumentIntelligenceStructuredResult | null;
    fact: ReviewFact | null;
  }[] =
    facts.kind === "loading"
      ? []
      : [
          ...resultRows,
          ...factItems
            .filter((fact) => !pairedFactIds.has(fact.id))
            .map((fact) => ({ key: fact.factKey, result: null, fact })),
        ];
  const selectedRow = rows.find((row) => row.key === selectedResultKey) ?? rows[0] ?? null;
  const selectedFact = selectedRow?.fact ?? null;
  const selectedResult = selectedRow?.result ?? null;
  const selectedCode =
    selectedFact === null ? (selectedResult?.code ?? null) : selectedFact.proposedCanonicalCode;
  const selectedDate =
    selectedFact === null ? (selectedResult?.date ?? null) : selectedFact.proposedSampledAt;
  const selectedLaboratory =
    selectedFact === null ? (selectedResult?.lab ?? null) : selectedFact.proposedLaboratory;
  const selectedMissingFields = documentResultMissingFields({
    code: selectedCode,
    date: selectedDate,
    lab: selectedLaboratory,
  });
  const selectedDisplayName =
    selectedFact?.canonicalDisplayName ??
    selectedResult?.label ??
    selectedFact?.sourceName ??
    "Результат";
  const selectedSource = selectedFact?.source ?? selectedResult?.source ?? null;
  const selectedConfidence = selectedFact?.confidence ?? selectedResult?.confidence ?? null;
  const selectedConfidenceCopy =
    selectedConfidence === null
      ? null
      : new Intl.NumberFormat("ru-RU", {
          style: "percent",
          maximumFractionDigits: 0,
        }).format(selectedConfidence);
  const selectedCorrection =
    selectedFact === null
      ? undefined
      : (selectedFact.review?.correction ?? confirmedCorrections.get(selectedFact.id));
  const journalFact = selectedFact;
  const historyFact = selectedFact;
  const historyCode = historyFact?.proposedCanonicalCode ?? null;

  return (
    <section
      className="document-review-workspace"
      aria-labelledby="document-review-title"
      aria-busy={facts.kind === "loading" || reviewPending}
      data-testid="document-review-workspace"
    >
      <div className="document-review-workspace__body">
        <header className="document-review-workspace__heading">
          <div>
            <p className="context-line">Структурированные данные</p>
            <h3 id="document-review-title">Результаты исследования</h3>
            <p>Выберите значение, сверьте источник и примите отдельное решение.</p>
          </div>
          {pendingFacts.length > 0 ? (
            <div className="document-review-workspace__bulk">
              <span>
                {archiveValueCountCopy(pendingFacts.length)}{" "}
                {pluralForm(pendingFacts.length, ["требует", "требуют", "требуют"])} решения
                {individualReviewCount > 0 ? (
                  <small>{archiveValueCountCopy(individualReviewCount)} — только по одному</small>
                ) : null}
              </span>
              {bulkConfirmableFacts.length > 0 ? (
                <button
                  className="button button--primary"
                  type="button"
                  disabled={reviewPending}
                  onClick={() => void confirmAll(bulkConfirmableFacts)}
                >
                  <CheckCheck size={18} aria-hidden="true" />
                  {bulkReview.kind === "running"
                    ? `Подтверждаем ${bulkReview.completed} из ${bulkReview.total}…`
                    : `Подтвердить без замечаний ${bulkConfirmableFacts.length}`}
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        {bulkReview.kind === "success" ? (
          <p className="document-review__bulk-notice" role="status">
            Подтверждено {archiveValueCountCopy(bulkReview.total)}
          </p>
        ) : null}
        {bulkReview.kind === "error" ? (
          <p className="form-error document-review__bulk-error" role="alert">
            {bulkReview.completed === 0
              ? "Не удалось начать массовое подтверждение. Ни одно значение не изменено."
              : `Подтверждено ${bulkReview.completed} из ${bulkReview.total}. Остальные значения не изменены; повторите действие.`}
          </p>
        ) : null}

        {reviewNotice !== null ? (
          <p className="review-fact__notice document-review-workspace__notice" role="status">
            {reviewNotice.copy}
          </p>
        ) : null}

        {processing.state !== "awaiting_review" && processing.state !== "completed" ? (
          <div className="review-empty" role="status">
            <p>Новый разбор ещё не завершён. Предыдущие результаты скрыты до проверки источника.</p>
          </div>
        ) : null}

        {facts.kind === "loading" && reviewAvailable ? (
          <div className="review-skeleton" aria-live="polite">
            <div className="skeleton skeleton--review-row" aria-hidden="true" />
            <p>Загружаем значения и их источники…</p>
          </div>
        ) : null}

        {facts.kind === "error" ? (
          <div className="review-empty" role="alert">
            <p>
              Черновые факты сейчас не загрузились. Общие результаты видны только как источник;
              решения временно недоступны.
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void loadFacts()}
            >
              Обновить список
            </button>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <ol
            className="document-result-grid document-result-grid--selectable"
            aria-label="Результаты документа"
          >
            {rows.map(({ key, result, fact }) => {
              const active = selectedRow?.key === key;
              const aboveRange = result?.status === "above_range";
              const displayName =
                fact?.canonicalDisplayName ?? result?.label ?? fact?.sourceName ?? "Результат";
              const value = result?.value ?? fact?.sourceValue ?? "Не указано";
              const unit = result?.unit ?? fact?.sourceUnit ?? null;
              return (
                <li key={key}>
                  <button
                    className={`document-result-card document-result-card--selectable${aboveRange ? " document-result-card--above-range" : ""}`}
                    type="button"
                    aria-pressed={active}
                    data-testid={`document-result-card-${key}`}
                    onClick={() => setSelectedResultKey(key)}
                  >
                    <span className="document-result-card__heading">
                      <span>
                        <span>
                          {[
                            result?.code ?? fact?.proposedCanonicalCode,
                            result === null
                              ? "Извлечённый факт"
                              : documentResultTypeCopy(result.type),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <strong>{displayName}</strong>
                      </span>
                      <span className="document-result-card__statuses">
                        {aboveRange ? (
                          <span className="document-result-status document-result-status--above_range">
                            {documentResultStatusCopy("above_range")}
                          </span>
                        ) : null}
                        {aboveRange && fact === null ? null : (
                          <span
                            className={`document-result-status document-result-status--${fact?.reviewStatus ?? result?.status ?? "unknown"}`}
                          >
                            {fact === null
                              ? result === null
                                ? "Результат"
                                : documentResultStatusCopy(result.status)
                              : reviewStatusLabel(fact.reviewStatus)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="document-result-card__value">
                      {value}
                      {unit === null ? null : <small>{unit}</small>}
                    </span>
                    <span className="document-result-card__meta">
                      {[
                        fact?.proposedLaboratory ?? result?.lab,
                        formatSampleMoment(fact?.proposedSampledAt ?? result?.date ?? ""),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Есть незаполненные поля"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {selectedRow !== null ? (
        <aside
          className="document-review-context"
          aria-label="Источник результата"
          data-testid="document-review-source"
        >
          <div className="document-review-context__eyebrow">
            <span>Источник результата</span>
            {selectedFact === null ? null : (
              <span>{reviewStatusLabel(selectedFact.reviewStatus)}</span>
            )}
          </div>
          <h4>{selectedDisplayName}</h4>
          <p className="document-review-context__value">
            {selectedFact?.sourceValue ?? selectedResult?.value ?? "Не указано"}{" "}
            <span>{selectedFact?.sourceUnit ?? selectedResult?.unit ?? ""}</span>
          </p>

          {selectedFact !== null ? (
            <p className={`document-review-context__state is-${selectedFact.reviewStatus}`}>
              <strong>{reviewStatusLabel(selectedFact.reviewStatus)}</strong>
              <span>{reviewStatusDescription(selectedFact.reviewStatus)}</span>
            </p>
          ) : null}

          {selectedSource !== null ? (
            <section className="document-review-context__source">
              <div>
                <strong>Страница {selectedSource.pageNumber}</strong>
                <a href={contentUrl} download>
                  Открыть источник
                </a>
              </div>
              <pre>
                <code>{selectedSource.fragment}</code>
              </pre>
              {selectedFact?.source.pageTextOrigin === "codex_vision" ? (
                <p className="document-review-context__origin" role="note">
                  Текст страницы — транскрипция Codex со скана или фото. Сверьте цитату с самим
                  изображением, а не с этим текстом.
                </p>
              ) : null}
              {selectedFact?.referenceRange !== null &&
              selectedFact?.referenceRange !== undefined ? (
                <dl className="document-review-context__range">
                  <div>
                    <dt>Диапазон в документе</dt>
                    <dd>{referenceRangeCopy(selectedFact.referenceRange)}</dd>
                  </div>
                </dl>
              ) : null}
            </section>
          ) : null}

          {selectedFact !== null &&
          isPendingReview(selectedFact.reviewStatus) &&
          canWriteProfile ? (
            <section className="document-review-context__decision">
              <h5>Ваше решение</h5>
              <p>Исходный факт останется неизменным при любом выборе.</p>
              <div className="document-review-context__actions">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={reviewPending}
                  onClick={() =>
                    void submitDecision(selectedFact, {
                      factVersion: selectedFact.factVersion,
                      decision: "confirm",
                    })
                  }
                >
                  {pendingFactId === selectedFact.id ? "Сохраняем…" : "Подтвердить результат"}
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={reviewPending}
                  aria-expanded={correctionFactId === selectedFact.id}
                  onClick={() =>
                    setCorrectionFactId((current) =>
                      current === selectedFact.id ? null : selectedFact.id,
                    )
                  }
                >
                  Исправить результат
                </button>
                <button
                  className="text-button document-review-context__reject"
                  type="button"
                  disabled={reviewPending}
                  onClick={() =>
                    void submitDecision(selectedFact, {
                      factVersion: selectedFact.factVersion,
                      decision: "reject",
                    })
                  }
                >
                  Отклонить результат
                </button>
              </div>
              {correctionFactId === selectedFact.id ? (
                <form
                  className="review-correction review-correction--context"
                  aria-label="Исправление результата"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void submitDecision(selectedFact, {
                      factVersion: selectedFact.factVersion,
                      decision: "correct",
                      correction: {
                        sourceName: String(form.get("sourceName") ?? "").trim(),
                        sourceValue: String(form.get("sourceValue") ?? "").trim(),
                        sourceUnit: String(form.get("sourceUnit") ?? "").trim(),
                      },
                    });
                  }}
                >
                  <label>
                    <span>Корректное название</span>
                    <input
                      name="sourceName"
                      required
                      maxLength={200}
                      defaultValue={selectedFact.sourceName}
                    />
                  </label>
                  <label>
                    <span>Корректное значение</span>
                    <input
                      name="sourceValue"
                      required
                      maxLength={100}
                      defaultValue={selectedFact.sourceValue}
                    />
                  </label>
                  <label>
                    <span>Корректная единица</span>
                    <input
                      name="sourceUnit"
                      required
                      maxLength={100}
                      defaultValue={selectedFact.sourceUnit}
                    />
                  </label>
                  <button className="button button--primary" type="submit" disabled={reviewPending}>
                    Сохранить исправление
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}

          {selectedFact !== null ? (
            <section
              className="document-review-context__proposal"
              aria-label={`Предложенные поля: ${selectedFact.sourceName}`}
            >
              <h5>Предложенные поля</h5>
              <dl>
                <div>
                  <dt>Код показателя</dt>
                  <dd>
                    {selectedFact.canonicalDisplayName === null
                      ? proposedValue(selectedFact.proposedCanonicalCode)
                      : `${selectedFact.canonicalDisplayName} · ${proposedValue(selectedFact.proposedCanonicalCode)}`}
                  </dd>
                </div>
                <div>
                  <dt>Нормализованное значение</dt>
                  <dd>
                    {selectedFact.proposedNormalizedValue === null
                      ? "Не предложено"
                      : `${selectedFact.proposedNormalizedValue} ${proposedValue(selectedFact.proposedNormalizedUnit)}`}
                  </dd>
                </div>
                <div>
                  <dt>Дата биоматериала</dt>
                  <dd>
                    {selectedFact.proposedSampledAt === null ? (
                      proposedValue(null)
                    ) : (
                      <time dateTime={selectedFact.proposedSampledAt}>
                        {formatSampleMoment(selectedFact.proposedSampledAt)}
                      </time>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Лаборатория</dt>
                  <dd>{proposedValue(selectedFact.proposedLaboratory)}</dd>
                </div>
              </dl>
              {selectedConfidenceCopy === null ? null : (
                <p className="document-review-context__confidence">
                  <span>Уверенность извлечения</span>
                  <strong>{selectedConfidenceCopy}</strong>
                </p>
              )}
              {selectedFact.validationIssues.length > 0 ? (
                <ul className="document-review-context__issues" aria-label="Причины проверки">
                  {selectedFact.validationIssues.map((issue) => (
                    <li key={issue}>{reviewIssueLabel(issue)}</li>
                  ))}
                </ul>
              ) : (
                <p className="document-review-context__issues-empty">Замечаний извлечения нет</p>
              )}
            </section>
          ) : null}

          <section
            className="document-review-completeness"
            data-testid="document-review-completeness"
          >
            <h5>Поля сопоставления</h5>
            {selectedMissingFields.length === 0 ? (
              <p className="is-complete">Код, дата и лаборатория найдены</p>
            ) : (
              <>
                <ul>
                  {selectedMissingFields.map((field) => (
                    <li key={field}>
                      <strong>{field}</strong>
                      <span>Не найдено</span>
                    </li>
                  ))}
                </ul>
                {canWriteProfile ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      onAskCodex(
                        `Уточни лабораторию, дату биоматериала и код показателя для результата «${selectedDisplayName}». Используй только этот исходник и укажи страницу и точный фрагмент.`,
                      )
                    }
                  >
                    Уточнить у Codex
                  </button>
                ) : null}
              </>
            )}
          </section>

          {selectedCorrection !== undefined ? (
            <section
              className="document-review-context__correction"
              aria-label="Подтверждённое исправление"
            >
              <h5>Подтверждённое исправление</h5>
              <dl>
                <div>
                  <dt>Название</dt>
                  <dd>{selectedCorrection.sourceName}</dd>
                </div>
                <div>
                  <dt>Значение</dt>
                  <dd>
                    {selectedCorrection.sourceValue} {selectedCorrection.sourceUnit}
                  </dd>
                </div>
                <div>
                  <dt>Единица</dt>
                  <dd>{selectedCorrection.sourceUnit}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {journalFact?.review !== null && journalFact?.review !== undefined ? (
            <section className="document-review-journal" data-testid="document-review-journal">
              <h5>Журнал решения</h5>
              <dl>
                <div>
                  <dt>Решение</dt>
                  <dd>{reviewStatusLabel(journalFact.reviewStatus)}</dd>
                </div>
                <div>
                  <dt>Кто</dt>
                  <dd>{journalFact.review.decidedBy.displayName}</dd>
                </div>
                <div>
                  <dt>Когда</dt>
                  <dd>
                    <time dateTime={journalFact.review.decidedAt}>
                      {formatDate(journalFact.review.decidedAt)}
                    </time>
                  </dd>
                </div>
                {facts.kind === "ready" ? (
                  <>
                    <div>
                      <dt>Идентификатор разбора</dt>
                      <dd>
                        <code>{facts.extractionRunId}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Версия экстрактора</dt>
                      <dd>{facts.extractorVersion}</dd>
                    </div>
                    <div>
                      <dt>Версия источника</dt>
                      <dd>{journalFact.source.documentVersionId.slice(0, 8)}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}

          {historyCode === null || historyFact === null ? null : (
            <DocumentIndicatorHistory
              familyId={familyId}
              profileId={profileId}
              canonicalCode={historyCode}
              displayName={historyFact.canonicalDisplayName ?? historyFact.sourceName}
            />
          )}

          {selectedFact !== null && reviewError?.factId === selectedFact.id ? (
            <p className="form-error" role="alert">
              {reviewError.copy}
            </p>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}

type DocumentIndicatorHistoryState =
  | { kind: "loading" }
  | { kind: "ready"; items: ObservationHistoryResponse["items"] }
  | { kind: "error" };

function DocumentIndicatorHistory({
  familyId,
  profileId,
  canonicalCode,
  displayName,
}: {
  familyId: string;
  profileId: string;
  canonicalCode: string;
  displayName: string;
}) {
  const [state, setState] = useState<DocumentIndicatorHistoryState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void apiRequest<ObservationHistoryResponse>(
      buildIndicatorHistoryPath(familyId, profileId, canonicalCode),
      { signal: controller.signal },
    )
      .then((response) => {
        if (!controller.signal.aborted) setState({ kind: "ready", items: response.items });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [canonicalCode, familyId, profileId]);

  return (
    <section className="document-review-history" data-testid="document-review-history">
      <div className="document-review-history__heading">
        <div>
          <h5>История показателя</h5>
          <span>{displayName}</span>
        </div>
        <Link
          href={`${profileTabPath(familyId, profileId, "history")}&canonicalCode=${encodeURIComponent(canonicalCode)}#observation-history`}
        >
          Открыть всю историю
        </Link>
      </div>
      {state.kind === "loading" ? <p role="status">Собираем подтверждённые значения…</p> : null}
      {state.kind === "error" ? <p>История сейчас недоступна.</p> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <p>После подтверждения здесь появится сопоставимая история.</p>
      ) : null}
      {state.kind === "ready" && state.items.length > 0 ? (
        <ol>
          {state.items.slice(0, 3).map((item) => (
            <li key={item.id}>
              <span>
                {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(
                  new Date(item.timelineAt),
                )}
              </span>
              <strong>
                {item.normalized.value ?? item.source.value}{" "}
                {item.normalized.unit ?? item.source.unit}
              </strong>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
