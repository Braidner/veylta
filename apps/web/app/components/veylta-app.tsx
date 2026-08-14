"use client";

import type {
  AdminSetupResponse,
  ArchivedProfileListResponse,
  CarePlanCategory,
  CarePlanItem,
  CarePlanItemResponse,
  CarePlanProposalResponse,
  CarePlanResponse,
  CodexRuntimeActionResponse,
  DocumentFactsResponse,
  DocumentProcessingResponse,
  DocumentProcessingRetryResponse,
  DocumentProcessingStatus,
  DocumentResponse,
  DocumentSummary,
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
  ProfileOverviewResponse,
  ProfileRestoreResponse,
  SessionFamily,
  SessionResponse,
  SetupStatusResponse,
  StorageRelocationResponse,
} from "@veylta/contracts";
import { DOCUMENT_CATEGORIES, MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import {
  ArrowRight,
  CalendarDays,
  CheckCheck,
  ClipboardList,
  Clock3,
  Files,
  FileUp,
  History,
  House,
  LogOut,
  Search,
  Settings,
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
import { adminSetupError, validateAdminSetup } from "../account-access";
import { ProfileDashboard } from "./profile-dashboard";
import { SystemStatus } from "./system-status";
import { VeyltaMark } from "./veylta-mark";

const apiPrefix = "/health-api";
const processingPollIntervalMs = 2_000;

type ScreenState =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "authenticated"; session: SessionResponse }
  | { kind: "error" };

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (
    init?.body !== undefined &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${apiPrefix}${path}`, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  if (!response.ok) {
    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: { code?: unknown } };
      if (typeof body.error?.code === "string") code = body.error.code;
    } catch {
      // The status remains authoritative when an intermediary returns no JSON envelope.
    }
    throw new ApiError(response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

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

function profilePath(familyId: string, profileId: string): string {
  return `/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}`;
}

const profileTabs = ["overview", "documents", "history", "plan"] as const;
type ProfileTab = (typeof profileTabs)[number];
type WorkspaceTab = ProfileTab | "settings";

function normalizeProfileTab(value: string | undefined): ProfileTab {
  return profileTabs.includes(value as ProfileTab) ? (value as ProfileTab) : "overview";
}

function profileTabPath(familyId: string, profileId: string, tab: ProfileTab): string {
  const base = profilePath(familyId, profileId);
  return tab === "overview" ? base : `${base}?tab=${tab}`;
}

function documentPath(familyId: string, profileId: string, documentId: string): string {
  return `${profilePath(familyId, profileId)}/documents/${encodeURIComponent(documentId)}`;
}

function documentProcessingPath(familyId: string, profileId: string, documentId: string): string {
  return `/v1${documentPath(familyId, profileId, documentId)}/processing`;
}

function documentFactsPath(familyId: string, profileId: string, documentId: string): string {
  return `/v1${documentPath(familyId, profileId, documentId)}/facts`;
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

function indicatorsPath(familyId: string, profileId: string): string {
  return `/v1${profilePath(familyId, profileId)}/indicators`;
}

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
  requestedTab?: string | undefined;
  requestedSettings?: boolean;
}

export function VeyltaApp({
  requestedFamilyId,
  requestedProfileId,
  requestedDocumentId,
  requestedTab,
  requestedSettings = false,
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
              id="workspace-tab-plan"
              className={`workspace-primary-nav__item ${activeTab === "plan" ? "workspace-primary-nav__item--active" : ""}`}
              href={profileTabPath(navigationProfile.familyId, navigationProfile.id, "plan")}
              role="tab"
              aria-selected={activeTab === "plan"}
              aria-controls="workspace-panel-plan"
              tabIndex={activeTab === "plan" ? 0 : -1}
            >
              <ClipboardList size={17} aria-hidden="true" />
              План
            </Link>
            {session?.user.role === "admin" ? (
              <Link
                id="workspace-tab-settings"
                className={`workspace-primary-nav__item ${activeTab === "settings" ? "workspace-primary-nav__item--active" : ""}`}
                href="/settings"
                role="tab"
                aria-selected={activeTab === "settings"}
                aria-controls="workspace-panel-settings"
                tabIndex={activeTab === "settings" ? 0 : -1}
              >
                <Settings size={17} aria-hidden="true" />
                Настройки
              </Link>
            ) : null}
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
          <span className="environment">
            <span aria-hidden="true" />
            Домашний сервер
          </span>
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
          <HomeSettingsScreen session={session} onSessionRefresh={refreshSession} />
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
            activeTab={activeTab === "settings" ? "overview" : activeTab}
            addProfileOpen={addProfileOpen}
            action={action}
            error={actionError}
            onProfileChange={(familyId, profileId) => {
              setActionError(null);
              router.push(profilePath(familyId, profileId));
            }}
            onAddProfileToggle={() => {
              setActionError(null);
              setAddProfileOpen((open) => !open);
            }}
            onAddProfile={handleAddProfile}
            onProfileArchived={refreshSessionAfterProfileArchive}
            onProfileRestored={refreshSessionAfterProfileRestore}
          />
        ) : null}
      </main>
    </>
  );
}

interface HomeSettingsScreenProps {
  session: SessionResponse;
  onSessionRefresh: () => Promise<void>;
}

function HomeSettingsScreen({ session, onSessionRefresh }: HomeSettingsScreenProps) {
  const [settings, setSettings] = useState<HomeSettingsResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [pending, setPending] = useState<"account" | "storage" | "codex" | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      setSettings(await apiRequest<HomeSettingsResponse>("/v1/settings"));
      setLoadState("ready");
    } catch (error) {
      setLoadState(error instanceof ApiError && error.status === 404 ? "denied" : "error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loadState === "loading") return <LoadingScreen copy="Проверяем домашний сервер…" />;
  if (loadState === "denied" || session.user.role !== "admin") {
    return <MissingSettingsScreen />;
  }
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
                <dt>App-server</dt>
                <dd>
                  {settings.codex.runtimeVersion ??
                    (settings.codex.daemonRunning ? "Запущен" : "Остановлен")}
                </dd>
              </div>
            </dl>
          </div>
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
  activeTab: ProfileTab;
  addProfileOpen: boolean;
  action: "setup" | "login" | "add-profile" | "logout" | null;
  error: string | null;
  onProfileChange: (familyId: string, profileId: string) => void;
  onAddProfileToggle: () => void;
  onAddProfile: (event: FormEvent<HTMLFormElement>, family: SessionFamily) => void;
  onProfileArchived: () => Promise<void>;
  onProfileRestored: () => Promise<void>;
}

function ProfileWorkspace({
  session,
  family,
  profile,
  requestedDocumentId,
  activeTab,
  addProfileOpen,
  action,
  error,
  onProfileChange,
  onAddProfileToggle,
  onAddProfile,
  onProfileArchived,
  onProfileRestored,
}: ProfileWorkspaceProps) {
  const router = useRouter();
  const profiles = session.families.flatMap((sessionFamily) => sessionFamily.profiles);
  const ownerCanAddProfile = family.role === "owner";
  const canWriteProfile = profile.access !== "granted_read";
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedUploads, setSelectedUploads] = useState<readonly File[]>([]);
  const [codexConsent, setCodexConsent] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
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

  useEffect(() => {
    const dialog = uploadDialog.current;
    if (dialog === null) return;
    if (uploadOpen && !dialog.open) dialog.showModal();
    if (!uploadOpen && dialog.open) dialog.close();
  }, [uploadOpen]);

  function openUploadDialog() {
    setSelectedUploads([]);
    setCodexConsent(false);
    setDocumentError(null);
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
    try {
      for (const file of selectedUploads) {
        const fingerprint = uploadFingerprint(file);
        const key = uploadAttempts.current.get(fingerprint) ?? crypto.randomUUID();
        uploadAttempts.current.set(fingerprint, key);
        const body = new FormData();
        body.append("file", file, file.name);
        try {
          const response = await apiRequest<DocumentResponse>(
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
        router.push(
          singleDocumentId === null
            ? profileTabPath(family.id, profile.id, "documents")
            : documentPath(family.id, profile.id, singleDocumentId),
        );
        router.refresh();
      }
    } finally {
      setUploadPending(false);
    }
  }

  return (
    <section
      className={`profile-shell profile-shell--${requestedDocumentId === undefined ? activeTab : "documents"}`}
      aria-labelledby="profile-title"
    >
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

      {error !== null && !addProfileOpen ? (
        <p className="form-error workspace-error" role="alert">
          {error}
        </p>
      ) : null}

      {requestedDocumentId === undefined && activeTab === "overview" ? (
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

      {requestedDocumentId === undefined && activeTab === "documents" ? (
        <div
          id="workspace-panel-documents"
          className="workspace-tab-panel workspace-tab-panel--documents"
          role="tabpanel"
          aria-labelledby="workspace-tab-documents"
          aria-label="Документы"
        >
          <div className="documents-workspace">
            {canWriteProfile ? (
              <DocumentInbox onUpload={openUploadDialog} />
            ) : (
              <ReadOnlyProfileNotice />
            )}
            <ProfileOverviewPanel
              key={`documents:${family.id}:${profile.id}`}
              familyId={family.id}
              profileId={profile.id}
              canWriteProfile={canWriteProfile}
              view="documents"
              onUpload={openUploadDialog}
            />
            {ownerCanAddProfile || family.role === "owner" ? (
              <details className="profile-management-drawer">
                <summary>Управление профилем и доступом</summary>
                <ProfileManagementRail
                  family={family}
                  profile={profile}
                  ownerCanAddProfile={ownerCanAddProfile}
                  addProfileOpen={addProfileOpen}
                  action={action}
                  error={error}
                  onAddProfileToggle={onAddProfileToggle}
                  onAddProfile={onAddProfile}
                  onProfileArchived={onProfileArchived}
                  onProfileRestored={onProfileRestored}
                />
              </details>
            ) : null}
          </div>
        </div>
      ) : null}

      {requestedDocumentId === undefined && activeTab === "history" ? (
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
          />
          <IndicatorCatalogPanel
            key={`indicators:${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
          />
        </div>
      ) : null}

      {requestedDocumentId === undefined && activeTab === "plan" ? (
        <div
          id="workspace-panel-plan"
          className="workspace-tab-panel workspace-tab-panel--plan"
          role="tabpanel"
          aria-labelledby="workspace-tab-plan"
          aria-label="План"
        >
          <HealthSummaryPanel
            key={`summary:${family.id}:${profile.id}`}
            familyId={family.id}
            profileId={profile.id}
          />
          <CarePlanPanel
            familyId={family.id}
            profileId={profile.id}
            canWriteProfile={canWriteProfile}
          />
        </div>
      ) : null}

      {requestedDocumentId !== undefined ? (
        <div
          id="workspace-panel-documents"
          className="workspace-tab-panel workspace-tab-panel--documents"
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
          familyAuditLogPath(familyId),
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
        `${familyAuditLogPath(familyId)}?cursor=${encodeURIComponent(auditLog.nextCursor)}`,
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
      return `${factCountCopy(status.factCount)} ждут явной проверки`;
    case "completed":
      return `${factCountCopy(status.factCount)} подтверждены пользователем`;
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

function DocumentArchiveList({
  documents,
  familyId,
  profileId,
}: {
  documents: ProfileOverviewResponse["recentDocuments"];
  familyId: string;
  profileId: string;
}) {
  const groups = [
    {
      id: "processing",
      label: "Codex распределяет",
      documents: documents.filter((document) => document.intelligence === null),
    },
    ...DOCUMENT_CATEGORIES.map((category) => ({
      id: category,
      label: documentCategoryLabels[category],
      documents: documents.filter((document) => document.intelligence?.category === category),
    })),
  ].filter((group) => group.documents.length > 0);

  return (
    <div className="document-category-groups">
      {groups.map((group) => (
        <section
          key={group.id}
          className="document-category-group"
          aria-labelledby={`group-${group.id}`}
        >
          <div className="document-category-group__heading">
            <h4 id={`group-${group.id}`}>{group.label}</h4>
            <span>{group.documents.length}</span>
          </div>
          <ol className="profile-overview__list">
            {group.documents.map((document) => (
              <li key={document.id} className="profile-overview__row">
                <div className="document-archive-row__identity">
                  <span className="document-archive-row__icon" aria-hidden="true">
                    <Files size={17} />
                  </span>
                  <div>
                    <strong>{document.intelligence?.title ?? document.originalFilename}</strong>
                    <span>
                      {documentKindLabel(document.contentType)} · {formatDate(document.uploadedAt)}
                    </span>
                  </div>
                </div>
                <div className="document-archive-row__actions">
                  <span className={`document-status document-status--${document.processing.state}`}>
                    {profileOverviewProcessingCopy(document.processing)}
                  </span>
                  <Link
                    className="document-archive-row__open"
                    href={documentPath(familyId, profileId, document.id)}
                    aria-label={`Открыть источник ${document.intelligence?.title ?? document.originalFilename}`}
                  >
                    <span>Открыть источник</span>
                    <ArrowRight
                      className="document-archive-row__arrow"
                      size={17}
                      aria-hidden="true"
                    />
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
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
            <div className="document-library__toolbar">
              <div className="document-library__stats">
                <span>
                  <strong>{state.overview.recentDocuments.length}</strong>в архиве
                </span>
                <span>
                  <strong>{state.overview.reviewQueue.documentCount}</strong>
                  ждут проверки
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

            <div className="profile-overview__sections">
              <section
                className={`profile-overview__section profile-overview__section--review${state.overview.reviewQueue.documentCount === 0 ? " profile-overview__section--quiet" : ""}`}
                aria-labelledby="overview-review-title"
              >
                <div className="profile-overview__section-heading">
                  <div>
                    <p className="context-line">Следующее действие</p>
                    <h3 id="overview-review-title">Проверка исходников</h3>
                  </div>
                  <span className="profile-overview__count">
                    <span className="visually-hidden">Документов в очереди: </span>
                    {state.overview.reviewQueue.documentCount}
                  </span>
                </div>
                {state.overview.reviewQueue.documentCount === 0 ? (
                  <div className="profile-overview__empty">
                    <p>
                      Ничего не ожидает проверки. Подтверждение всегда остаётся отдельным действием.
                    </p>
                  </div>
                ) : (
                  <ol className="profile-overview__list">
                    {state.overview.reviewQueue.documents.map((document) => (
                      <li key={document.id} className="profile-overview__row">
                        <div className="review-queue-row__identity">
                          <span className="review-queue-row__mark" aria-hidden="true">
                            !
                          </span>
                          <div>
                            <strong>{document.originalFilename}</strong>
                            <span>
                              {factCountCopy(document.pendingFactCount)} ждут решения
                              {document.needsAttentionFactCount > 0
                                ? ` · ${factCountCopy(document.needsAttentionFactCount)} требуют дополнительного внимания`
                                : ""}
                            </span>
                          </div>
                        </div>
                        <Link
                          className="button button--secondary review-queue-row__action"
                          href={documentPath(familyId, profileId, document.id)}
                        >
                          Открыть проверку
                          <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
                {state.overview.reviewQueue.documentCount >
                state.overview.reviewQueue.documents.length ? (
                  <p className="profile-overview__more">
                    Показаны 3 последних из {state.overview.reviewQueue.documentCount} документов в
                    очереди.
                  </p>
                ) : null}
              </section>

              <section
                className="profile-overview__section"
                aria-labelledby="overview-documents-title"
              >
                <div className="profile-overview__section-heading">
                  <div>
                    <p className="context-line">Неизменяемые байты</p>
                    <h3 id="overview-documents-title">Архив исходников</h3>
                  </div>
                </div>
                {state.overview.recentDocuments.length === 0 ? (
                  <div className="profile-overview__empty">
                    <p>Исходников пока нет. Статус появится здесь после первой загрузки.</p>
                    {canWriteProfile ? (
                      <button
                        className="text-link text-link--button"
                        type="button"
                        onClick={onUpload}
                      >
                        Добавить исходник
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <DocumentArchiveList
                    documents={state.overview.recentDocuments}
                    familyId={familyId}
                    profileId={profileId}
                  />
                )}
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

function formatUploadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
}

function DocumentInbox({ onUpload }: { onUpload: () => void }) {
  return (
    <section className="document-inbox" aria-labelledby="document-inbox-title">
      <div className="document-inbox__copy">
        <p className="context-line">Исходники и подтверждения</p>
        <h2 id="document-inbox-title">Документы профиля</h2>
        <p className="document-intro">
          Добавьте один файл или пачку. Codex распределит документы по разделам и подготовит
          значения для вашей проверки, не меняя оригиналы.
        </p>
      </div>
      <div className="document-inbox__actions">
        <button className="button button--primary" type="button" onClick={onUpload}>
          <FileUp size={18} aria-hidden="true" />
          Загрузить документы
        </button>
        <p className="synthetic-reminder" role="note">
          Только вымышленные PDF, PNG и JPEG до 5 МБ. Не загружайте реальные медицинские данные.
        </p>
      </div>
    </section>
  );
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
                  <small>{formatUploadSize(file.size)}</small>
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
            {pending
              ? "Передаём документы…"
              : selectedFiles.length === 1
                ? "Загрузить документ"
                : `Загрузить ${selectedFiles.length} документа`}
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

function referenceRangeCopy(
  referenceRange: NonNullable<ObservationHistoryItem["referenceRange"]>,
): string {
  if (referenceRange.sourceText !== null) return referenceRange.sourceText;
  if (referenceRange.sourceLow === null && referenceRange.sourceHigh === null) return "Не указан";
  const bounds = `${referenceRange.sourceLow ?? "…"} — ${referenceRange.sourceHigh ?? "…"}`;
  return referenceRange.sourceUnit === null ? bounds : `${bounds} ${referenceRange.sourceUnit}`;
}

function ObservationHistoryPanel({ familyId, profileId }: ObservationHistoryPanelProps) {
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
          observationHistoryPath(familyId, profileId),
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
    [familyId, profileId],
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
        `${observationHistoryPath(familyId, profileId)}?cursor=${encodeURIComponent(history.nextCursor)}`,
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

function IndicatorCatalogPanel({ familyId, profileId }: ObservationHistoryPanelProps) {
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
          const first = response.items[0];
          const firstUnit = first?.units[0];
          return first === undefined || firstUnit === undefined
            ? null
            : { canonicalCode: first.canonicalCode, unit: firstUnit.unit };
        });
      } catch (error) {
        if (!signal?.aborted) setCatalog({ kind: "error", copy: indicatorCatalogErrorCopy(error) });
      }
    },
    [familyId, profileId],
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
  | { kind: "ready"; document: DocumentSummary }
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

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    apiRequest<DocumentResponse>(
      `/v1/families/${encodeURIComponent(family.id)}/profiles/${encodeURIComponent(profile.id)}/documents/${encodeURIComponent(documentId)}`,
    )
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
  }, [documentId, family.id, profile.id]);

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
  const contentUrl = `${apiPrefix}/v1/families/${encodeURIComponent(family.id)}/profiles/${encodeURIComponent(profile.id)}/documents/${encodeURIComponent(savedDocument.id)}/content`;

  return (
    <section className="document-view" aria-labelledby="document-title">
      <Link className="back-link" href={profileTabPath(family.id, profile.id, "documents")}>
        ← Открыть документы
      </Link>
      <p className="document-state">
        <span aria-hidden="true" />
        Исходник сохранён без изменений
      </p>
      <h2 id="document-title">
        {savedDocument.intelligence?.title ?? savedDocument.originalFilename}
      </h2>
      <p className="document-meta">
        {savedDocument.intelligence === null ? "" : `${savedDocument.originalFilename} · `}
        {documentKindLabel(savedDocument.contentType)} · {formatBytes(savedDocument.byteSize)} ·{" "}
        {formatDate(savedDocument.uploadedAt)}
      </p>

      {savedDocument.intelligence !== null ? (
        <div className="document-intelligence-summary" role="status">
          <span>Распределено Codex</span>
          <strong>{documentCategoryLabels[savedDocument.intelligence.category]}</strong>
          <small>
            Уверенность {Math.round(savedDocument.intelligence.confidence * 100)}% · результат
            требует проверки человеком
          </small>
        </div>
      ) : null}

      {savedDocument.duplicate.possible ? (
        <div className="duplicate-note" role="status">
          <strong>Возможный дубликат</strong>
          <p>SHA-256 совпадает с ранее загруженным документом этой семьи.</p>
        </div>
      ) : null}

      <div className="document-actions">
        <a className="button button--primary" href={contentUrl} download>
          {downloadLabel(savedDocument.contentType)}
        </a>
      </div>

      <DocumentProcessingPanel
        familyId={family.id}
        profileId={profile.id}
        document={savedDocument}
        canWriteProfile={canWriteProfile}
      />
    </section>
  );
}

interface DocumentProcessingPanelProps {
  familyId: string;
  profileId: string;
  document: DocumentSummary;
  canWriteProfile: boolean;
}

interface ProcessingPresentation {
  heading: string;
  copy: string;
  integrityLabel: string;
  mark: "—" | "…" | "!" | "✓";
  tone: "idle" | "active" | "attention" | "complete" | "failed";
}

function isProcessingActive(status: DocumentProcessingStatus): boolean {
  return (
    status.state === "queued" ||
    status.state === "security_check" ||
    status.state === "text_extraction" ||
    status.state === "document_classification" ||
    status.state === "structured_extraction" ||
    status.state === "validation"
  );
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

function russianPlural(value: number, singular: string, few: string, many: string): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 14) return many;
  const last = value % 10;
  if (last === 1) return singular;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function factCountCopy(value: number): string {
  return `${value} ${russianPlural(value, "значение", "значения", "значений")}`;
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

function downloadLabel(contentType: DocumentSummary["contentType"]): string {
  switch (contentType) {
    case "application/pdf":
      return "Скачать исходный PDF";
    case "image/png":
      return "Скачать исходный PNG";
    case "image/jpeg":
      return "Скачать исходный JPEG";
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
        copy: `Найдено ${factCountCopy(status.factCount)}; ${factCountCopy(status.needsReviewCount)} требуют дополнительного внимания. Ничего не подтверждено автоматически.`,
        integrityLabel: "Ожидает проверки",
        mark: "!",
        tone: "attention",
      };
    case "completed":
      return {
        heading: "Извлечение завершено",
        copy: `Сохранено ${factCountCopy(status.factCount)} для последующей проверки вместе с источником. Ничего не интерпретировано автоматически.`,
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
}: DocumentProcessingPanelProps) {
  const [processing, setProcessing] = useState<DocumentProcessingStatus>(savedDocument.processing);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryKey = useRef<string | null>(null);

  const refreshProcessing = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await apiRequest<DocumentProcessingResponse>(
          documentProcessingPath(familyId, profileId, savedDocument.id),
          signal === undefined ? undefined : { signal },
        );
        if (signal?.aborted) return;
        setRefreshFailed(false);
        setProcessing((current) =>
          processingStatusesEqual(current, response.processing) ? current : response.processing,
        );
      } catch {
        if (!signal?.aborted) setRefreshFailed(true);
      }
    },
    [familyId, profileId, savedDocument.id],
  );

  const refreshAfterReview = useCallback(() => {
    void refreshProcessing();
  }, [refreshProcessing]);

  useEffect(() => {
    setProcessing(savedDocument.processing);
    setRefreshFailed(false);
    setRetryError(null);
    retryKey.current = null;
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

  async function handleRetry(): Promise<void> {
    setRetryPending(true);
    setRetryError(null);
    const commandKey = retryKey.current ?? crypto.randomUUID();
    retryKey.current = commandKey;
    try {
      const response = await apiRequest<DocumentProcessingRetryResponse>(
        `${documentProcessingPath(familyId, profileId, savedDocument.id)}/retry`,
        {
          method: "POST",
          headers: { "Idempotency-Key": commandKey },
        },
      );
      setRefreshFailed(false);
      setProcessing(response.processing);
      retryKey.current = null;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) retryKey.current = null;
      setRetryError("Не удалось запустить повторную обработку. Статус и исходник не изменились.");
    } finally {
      setRetryPending(false);
    }
  }

  const presentation = processingPresentation(processing);
  const showRetry = canWriteProfile && processing.state === "failed" && processing.retryAllowed;

  return (
    <>
      <section
        className={`processing-state processing-state--${presentation.tone}`}
        aria-labelledby="processing-title"
        aria-busy={isProcessingActive(processing) || retryPending}
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
          {showRetry ? (
            <button
              className="button button--secondary processing-state__retry"
              type="button"
              onClick={handleRetry}
              disabled={retryPending}
            >
              {retryPending ? "Запускаем повтор…" : "Повторить обработку"}
            </button>
          ) : null}
          {retryError !== null ? (
            <p className="form-error processing-state__error" role="alert">
              {retryError}
            </p>
          ) : null}
        </div>
      </section>

      {canWriteProfile &&
      (processing.state === "awaiting_review" || processing.state === "completed") ? (
        <DocumentReviewPanel
          familyId={familyId}
          profileId={profileId}
          documentId={savedDocument.id}
          onReviewSaved={refreshAfterReview}
        />
      ) : null}

      <details className="integrity-details">
        <summary>Проверить целостность</summary>
        <dl>
          <div>
            <dt>SHA-256</dt>
            <dd>
              <code>{savedDocument.sha256}</code>
            </dd>
          </div>
          <div>
            <dt>Статус обработки</dt>
            <dd>{presentation.integrityLabel}</dd>
          </div>
        </dl>
      </details>
    </>
  );
}

type ReviewFactStatus = ExtractedFactReviewStatus;
type ReviewFact = DocumentFactsResponse["items"][number];

type FactListState =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly ReviewFact[] }
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

function reviewStatusLabel(status: ReviewFactStatus): string {
  switch (status) {
    case "extracted":
    case "needs_review":
      return "Не подтверждено";
    case "confirmed":
      return "Подтверждено пользователем";
    case "rejected":
      return "Отклонено пользователем";
  }
}

function reviewStatusDescription(status: ReviewFactStatus): string {
  switch (status) {
    case "extracted":
      return "Автоматическое извлечение ожидает явного решения пользователя.";
    case "needs_review":
      return "Есть неопределённость в извлечении; решение нельзя принять автоматически.";
    case "confirmed":
      return "Создано подтверждённое значение с сохранённой ссылкой на источник.";
    case "rejected":
      return "Исходное извлечение сохранено как источник, но не стало подтверждённым значением.";
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
  onReviewSaved: () => void;
}

function DocumentReviewPanel({
  familyId,
  profileId,
  documentId,
  onReviewSaved,
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
        });
      } catch {
        if (!signal?.aborted) setFacts({ kind: "error" });
      }
    },
    [documentId, familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadFacts(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadFacts]);

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
  const reviewPending = pendingFactId !== null || bulkReview.kind === "running";

  return (
    <section
      className="document-review"
      aria-labelledby="document-review-title"
      aria-busy={facts.kind === "loading" || reviewPending}
    >
      <div className="document-review__heading">
        <p className="context-line">Проверка источника</p>
        <h3 id="document-review-title">Проверьте извлечённые значения</h3>
        <p>
          Автоматическое извлечение остаётся черновиком, пока вы не сверите его со страницей и не
          выберете действие. Здесь нет медицинской интерпретации.
        </p>
        {pendingFacts.length > 0 ? (
          <div className="document-review__bulk">
            <div>
              <strong>{factCountCopy(pendingFacts.length)} ждут решения</strong>
              <span>
                Массовое подтверждение относится только к этому документу. Исходные фрагменты
                останутся доступными.
              </span>
            </div>
            <button
              className="button button--primary"
              type="button"
              disabled={reviewPending}
              onClick={() => void confirmAll(pendingFacts)}
            >
              <CheckCheck size={18} aria-hidden="true" />
              {bulkReview.kind === "running"
                ? `Подтверждаем ${bulkReview.completed} из ${bulkReview.total}…`
                : `Подтвердить все ${pendingFacts.length}`}
            </button>
          </div>
        ) : null}
        {bulkReview.kind === "success" ? (
          <p className="document-review__bulk-notice" role="status">
            Подтверждено {factCountCopy(bulkReview.total)}
          </p>
        ) : null}
        {bulkReview.kind === "error" ? (
          <p className="form-error document-review__bulk-error" role="alert">
            {bulkReview.completed === 0
              ? "Не удалось начать массовое подтверждение. Ни одно значение не изменено."
              : `Подтверждено ${bulkReview.completed} из ${bulkReview.total}. Остальные значения не изменены; повторите действие.`}
          </p>
        ) : null}
        <Link
          className="document-review__history-link"
          href={profileTabPath(familyId, profileId, "history")}
        >
          Открыть историю подтверждённых значений
        </Link>
      </div>

      {facts.kind === "loading" ? (
        <div className="review-skeleton" aria-live="polite">
          <div className="skeleton skeleton--review-heading" aria-hidden="true" />
          <div className="skeleton skeleton--review-row" aria-hidden="true" />
          <p>Загружаем черновые значения и их источник…</p>
        </div>
      ) : null}

      {facts.kind === "error" ? (
        <div className="review-empty" role="status">
          <p>Черновые значения сейчас не загрузились. Исходник и решения не изменены.</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadFacts()}
          >
            Обновить список
          </button>
        </div>
      ) : null}

      {facts.kind === "ready" && facts.items.length === 0 ? (
        <div className="review-empty" role="status">
          <p>В этом запуске нет значений для проверки.</p>
        </div>
      ) : null}

      {facts.kind === "ready" && facts.items.length > 0 ? (
        <div className="review-fact-list">
          {facts.items.map((fact) => (
            <ReviewFactCard
              key={fact.id}
              fact={fact}
              pending={pendingFactId === fact.id}
              anyPending={reviewPending}
              correctionOpen={correctionFactId === fact.id}
              error={reviewError?.factId === fact.id ? reviewError.copy : null}
              notice={reviewNotice?.factId === fact.id ? reviewNotice.copy : null}
              confirmedCorrection={fact.review?.correction ?? confirmedCorrections.get(fact.id)}
              onCorrectionToggle={() => {
                setReviewError(null);
                setReviewNotice(null);
                setCorrectionFactId((current) => (current === fact.id ? null : fact.id));
              }}
              onDecision={submitDecision}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface ReviewFactCardProps {
  fact: ReviewFact;
  pending: boolean;
  anyPending: boolean;
  correctionOpen: boolean;
  error: string | null;
  notice: string | null;
  confirmedCorrection: ConfirmedCorrection | undefined;
  onCorrectionToggle: () => void;
  onDecision: (fact: ReviewFact, command: ReviewCommand) => Promise<void>;
}

function ReviewFactCard({
  fact,
  pending,
  anyPending,
  correctionOpen,
  error,
  notice,
  confirmedCorrection,
  onCorrectionToggle,
  onDecision,
}: ReviewFactCardProps) {
  const pendingDecision = isPendingReview(fact.reviewStatus);
  const confidence = new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(fact.confidence);
  const isDisabled = anyPending;

  async function submitCorrection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onDecision(fact, {
      factVersion: fact.factVersion,
      decision: "correct",
      correction: {
        sourceName: String(form.get("sourceName") ?? "").trim(),
        sourceValue: String(form.get("sourceValue") ?? "").trim(),
        sourceUnit: String(form.get("sourceUnit") ?? "").trim(),
      },
    });
  }

  return (
    <article className="review-fact" aria-labelledby={`review-fact-${fact.id}`}>
      <div className="review-fact__summary">
        <div>
          <p className="review-fact__key">Извлечённый факт</p>
          <h4 id={`review-fact-${fact.id}`}>{fact.sourceName}</h4>
        </div>
        <p className={`review-fact__state review-fact__state--${fact.reviewStatus}`}>
          <strong>{reviewStatusLabel(fact.reviewStatus)}</strong>
          <span>{reviewStatusDescription(fact.reviewStatus)}</span>
        </p>
      </div>

      <div className="review-fact__evidence">
        <section className="review-fact__source" aria-label={`Источник: ${fact.sourceName}`}>
          <h5>Источник</h5>
          <dl>
            <div>
              <dt>Как в документе</dt>
              <dd>
                {fact.sourceValue} {fact.sourceUnit}
              </dd>
            </div>
            <div>
              <dt>Страница</dt>
              <dd>Страница {fact.source.pageNumber}</dd>
            </div>
            {fact.referenceRange !== null && fact.referenceRange.sourceText !== null ? (
              <div>
                <dt>Диапазон в документе</dt>
                <dd>{fact.referenceRange.sourceText}</dd>
              </div>
            ) : null}
          </dl>
          <p className="review-fact__provenance">Фрагмент из исходника</p>
          <pre className="review-fact__fragment">
            <code>{fact.source.fragment}</code>
          </pre>
        </section>

        <section
          className="review-fact__proposal"
          aria-label={`Предложенные поля: ${fact.sourceName}`}
        >
          <h5>Предложенные поля</h5>
          <dl>
            <div>
              <dt>Код показателя</dt>
              <dd>{proposedValue(fact.proposedCanonicalCode)}</dd>
            </div>
            <div>
              <dt>Нормализованное значение</dt>
              <dd>
                {fact.proposedNormalizedValue === null
                  ? "Не предложено"
                  : `${fact.proposedNormalizedValue} ${proposedValue(fact.proposedNormalizedUnit)}`}
              </dd>
            </div>
            <div>
              <dt>Дата биоматериала</dt>
              <dd>{proposedValue(fact.proposedSampledAt)}</dd>
            </div>
            <div>
              <dt>Лаборатория</dt>
              <dd>{proposedValue(fact.proposedLaboratory)}</dd>
            </div>
          </dl>
          <p className="review-fact__confidence">Уверенность извлечения: {confidence}</p>
          {fact.validationIssues.length > 0 ? (
            <ul className="review-fact__issues" aria-label="Причины проверки">
              {fact.validationIssues.map((issue) => (
                <li key={issue}>{reviewIssueLabel(issue)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      {confirmedCorrection !== undefined ? (
        <section
          className="review-fact__confirmed-correction"
          aria-label={`Подтверждённое исправление: ${fact.sourceName}`}
        >
          <h5>Подтверждённое исправление</h5>
          <dl>
            <div>
              <dt>Название</dt>
              <dd>{confirmedCorrection.sourceName}</dd>
            </div>
            <div>
              <dt>Значение</dt>
              <dd>
                {confirmedCorrection.sourceValue} {confirmedCorrection.sourceUnit}
              </dd>
            </div>
            <div>
              <dt>Единица</dt>
              <dd>{confirmedCorrection.sourceUnit}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {pendingDecision ? (
        <div className="review-fact__decision">
          <p>
            Сверьте источник. Подтверждение создаст отдельное подтверждённое значение; исходный факт
            останется неизменным.
          </p>
          <div className="review-fact__actions">
            <button
              className="button button--primary"
              type="button"
              disabled={isDisabled}
              aria-label={`Подтвердить ${fact.sourceName}`}
              onClick={() =>
                void onDecision(fact, { factVersion: fact.factVersion, decision: "confirm" })
              }
            >
              {pending ? "Сохраняем…" : "Подтвердить"}
            </button>
            <button
              className="button button--secondary"
              type="button"
              disabled={isDisabled}
              aria-expanded={correctionOpen}
              aria-controls={`correction-${fact.id}`}
              aria-label={`Исправить ${fact.sourceName}`}
              onClick={onCorrectionToggle}
            >
              Исправить
            </button>
            <button
              className="button button--secondary review-fact__reject"
              type="button"
              disabled={isDisabled}
              aria-label={`Отклонить ${fact.sourceName}`}
              onClick={() =>
                void onDecision(fact, { factVersion: fact.factVersion, decision: "reject" })
              }
            >
              Отклонить
            </button>
          </div>

          {correctionOpen ? (
            <form
              id={`correction-${fact.id}`}
              className="review-correction"
              aria-label={`Исправление: ${fact.sourceName}`}
              onSubmit={(event) => void submitCorrection(event)}
            >
              <p>Введите проверенные поля. Исходное извлечение останется доступным выше.</p>
              <div className="review-correction__fields">
                <label className="field">
                  <span>Корректное название</span>
                  <input
                    name="sourceName"
                    type="text"
                    required
                    minLength={1}
                    maxLength={200}
                    defaultValue={fact.sourceName}
                    disabled={isDisabled}
                  />
                </label>
                <label className="field">
                  <span>Корректное значение</span>
                  <input
                    name="sourceValue"
                    type="text"
                    required
                    minLength={1}
                    maxLength={100}
                    defaultValue={fact.sourceValue}
                    disabled={isDisabled}
                  />
                </label>
                <label className="field">
                  <span>Корректная единица</span>
                  <input
                    name="sourceUnit"
                    type="text"
                    required
                    minLength={1}
                    maxLength={100}
                    defaultValue={fact.sourceUnit}
                    disabled={isDisabled}
                  />
                </label>
              </div>
              <div className="review-correction__actions">
                <button className="button button--primary" type="submit" disabled={isDisabled}>
                  {pending ? "Сохраняем…" : "Сохранить исправление"}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={isDisabled}
                  onClick={onCorrectionToggle}
                >
                  Отменить
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {notice !== null ? (
        <p className="review-fact__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p className="form-error review-fact__error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1024)} КБ`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
