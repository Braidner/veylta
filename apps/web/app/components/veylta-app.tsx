"use client";

import type {
  DemoRegistrationResponse,
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
  IndicatorCatalogResponse,
  IndicatorSeriesResponse,
  ObservationHistoryResponse,
  PatientProfileSummary,
  ProfileCreateResponse,
  SessionFamily,
  SessionResponse,
} from "@veylta/contracts";
import { MAX_SYNTHETIC_PDF_BYTES } from "@veylta/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SystemStatus } from "./system-status";

const apiPrefix = "/health-api";
const processingPollIntervalMs = 2_000;

type ScreenState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "authenticated"; session: SessionResponse }
  | { kind: "error" };

class ApiError extends Error {
  constructor(readonly status: number) {
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
    throw new ApiError(response.status);
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

function documentPath(familyId: string, profileId: string, documentId: string): string {
  return `${profilePath(familyId, profileId)}/documents/${encodeURIComponent(documentId)}`;
}

function documentProcessingPath(familyId: string, profileId: string, documentId: string): string {
  return `/v1${documentPath(familyId, profileId, documentId)}/processing`;
}

function documentFactsPath(familyId: string, profileId: string, documentId: string): string {
  return `/v1${documentPath(familyId, profileId, documentId)}/facts`;
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

interface VeyltaAppProps {
  requestedFamilyId?: string;
  requestedProfileId?: string;
  requestedDocumentId?: string;
}

export function VeyltaApp({
  requestedFamilyId,
  requestedProfileId,
  requestedDocumentId,
}: VeyltaAppProps) {
  const router = useRouter();
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [action, setAction] = useState<"register" | "add-profile" | "logout" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addProfileOpen, setAddProfileOpen] = useState(false);
  const requestedContext =
    requestedFamilyId !== undefined && requestedProfileId !== undefined
      ? { familyId: requestedFamilyId, profileId: requestedProfileId }
      : undefined;
  const hasRequestedProfile = requestedContext !== undefined;

  useEffect(() => {
    let active = true;

    readSession()
      .then((session) => {
        if (!active) return;

        if (session === null) {
          setScreen({ kind: "unauthenticated" });
          if (hasRequestedProfile) router.replace("/");
          return;
        }

        setScreen({ kind: "authenticated", session });
        if (!hasRequestedProfile) {
          const profile = firstProfile(session);
          if (profile !== undefined) router.replace(profilePath(profile.familyId, profile.id));
        }
      })
      .catch(() => {
        if (active) setScreen({ kind: "error" });
      });

    return () => {
      active = false;
    };
  }, [hasRequestedProfile, router]);

  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction("register");
    setActionError(null);

    const form = new FormData(event.currentTarget);
    try {
      const registration = await apiRequest<DemoRegistrationResponse>("/v1/demo/registrations", {
        method: "POST",
        body: JSON.stringify({
          displayName: String(form.get("displayName") ?? "").trim(),
          familyName: String(form.get("familyName") ?? "").trim(),
          profileName: String(form.get("profileName") ?? "").trim(),
        }),
      });
      const session = await readSession();
      if (session === null) throw new Error("Session was not created");
      setScreen({ kind: "authenticated", session });
      router.replace(profilePath(registration.family.id, registration.profile.id));
    } catch {
      setActionError("Не удалось создать пространство. Проверьте поля и попробуйте ещё раз.");
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
      setScreen({ kind: "unauthenticated" });
      setAddProfileOpen(false);
      router.replace("/");
    } catch {
      setAddProfileOpen(false);
      setActionError("Не удалось завершить сессию. Попробуйте ещё раз.");
    } finally {
      setAction(null);
    }
  }

  const session = screen.kind === "authenticated" ? screen.session : undefined;
  const context =
    session !== undefined && requestedContext !== undefined
      ? findProfileContext(session, requestedContext.familyId, requestedContext.profileId)
      : undefined;
  const redirectProfile = session === undefined ? undefined : firstProfile(session);
  const pageTitle = context === undefined ? "Veylta" : `${context.profile.displayName} — Veylta`;

  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Перейти к содержанию
      </a>
      <header className="workspace-bar">
        <Link className="wordmark" href="/" aria-label="Veylta — главная">
          <span aria-hidden="true">V</span>
          Veylta
        </Link>
        <div className="workspace-actions">
          <span className="environment">Только синтетика</span>
          {session !== undefined ? (
            <button
              className="text-button"
              type="button"
              onClick={handleLogout}
              disabled={action === "logout"}
            >
              {action === "logout" ? "Выходим…" : "Выйти"}
            </button>
          ) : null}
        </div>
      </header>

      <main id="main-content">
        {screen.kind === "loading" ? <LoadingScreen /> : null}
        {screen.kind === "error" ? <ErrorScreen onRetry={() => window.location.reload()} /> : null}
        {screen.kind === "unauthenticated" && !hasRequestedProfile ? (
          <OnboardingScreen
            pending={action === "register"}
            error={actionError}
            onSubmit={handleRegistration}
          />
        ) : null}
        {screen.kind === "unauthenticated" && hasRequestedProfile ? (
          <LoadingScreen copy="Возвращаем к началу…" />
        ) : null}
        {session !== undefined && !hasRequestedProfile ? (
          <LoadingScreen copy="Открываем профиль…" />
        ) : null}
        {session !== undefined && hasRequestedProfile && context === undefined ? (
          <MissingProfileScreen fallbackProfile={redirectProfile} />
        ) : null}
        {session !== undefined && context !== undefined ? (
          <ProfileWorkspace
            session={session}
            family={context.family}
            profile={context.profile}
            requestedDocumentId={requestedDocumentId}
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
          />
        ) : null}
      </main>
    </>
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

interface OnboardingScreenProps {
  pending: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function OnboardingScreen({ pending, error, onSubmit }: OnboardingScreenProps) {
  return (
    <section className="onboarding-shell" aria-labelledby="onboarding-title">
      <div className="onboarding-intro">
        <p className="context-line">Спокойная семейная история здоровья</p>
        <h1 id="onboarding-title">Создайте семейное пространство</h1>
        <p className="lede">
          Начните с владельца и одного профиля. Активный человек всегда будет указан в заголовке и
          адресе страницы.
        </p>
        <div className="privacy-note">
          <span className="privacy-note__mark" aria-hidden="true">
            S
          </span>
          <div>
            <strong>Сейчас — только синтетические данные</strong>
            <p>
              Используйте вымышленные имена. Реальные медицинские документы и адрес электронной
              почты на этом этапе не нужны.
            </p>
          </div>
        </div>
        <SystemStatus />
      </div>

      <form
        className="onboarding-form"
        onSubmit={onSubmit}
        aria-busy={pending}
        aria-describedby="demo-form-note"
      >
        <div className="form-heading">
          <p>Шаг 1 из 1</p>
          <h2>Владелец и семья</h2>
        </div>

        <label className="field">
          <span>Имя владельца</span>
          <input
            name="displayName"
            type="text"
            required
            minLength={1}
            maxLength={120}
            autoComplete="off"
            placeholder="Например, Владелец 01"
            disabled={pending}
          />
        </label>

        <label className="field">
          <span>Название семьи</span>
          <input
            name="familyName"
            type="text"
            required
            minLength={1}
            maxLength={120}
            autoComplete="off"
            placeholder="Например, Семья 01"
            disabled={pending}
          />
        </label>

        <label className="field">
          <span>Имя профиля</span>
          <input
            name="profileName"
            type="text"
            required
            minLength={1}
            maxLength={120}
            autoComplete="off"
            placeholder="Например, Профиль 01"
            disabled={pending}
          />
        </label>

        {error !== null ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="button button--primary button--wide" type="submit" disabled={pending}>
          {pending ? "Создаём…" : "Создать пространство"}
        </button>
        <p id="demo-form-note" className="form-note">
          Демо-сессия хранится в защищённой HttpOnly cookie. В браузере нет токена доступа.
        </p>
      </form>
    </section>
  );
}

interface ProfileWorkspaceProps {
  session: SessionResponse;
  family: SessionFamily;
  profile: PatientProfileSummary;
  requestedDocumentId: string | undefined;
  addProfileOpen: boolean;
  action: "register" | "add-profile" | "logout" | null;
  error: string | null;
  onProfileChange: (familyId: string, profileId: string) => void;
  onAddProfileToggle: () => void;
  onAddProfile: (event: FormEvent<HTMLFormElement>, family: SessionFamily) => void;
}

function ProfileWorkspace({
  session,
  family,
  profile,
  requestedDocumentId,
  addProfileOpen,
  action,
  error,
  onProfileChange,
  onAddProfileToggle,
  onAddProfile,
}: ProfileWorkspaceProps) {
  const router = useRouter();
  const profiles = session.families.flatMap((sessionFamily) => sessionFamily.profiles);
  const ownerCanAddProfile = family.role === "owner";
  const [uploadPending, setUploadPending] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const uploadAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  async function handleDocumentUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDocumentError(null);

    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setDocumentError("Выберите один синтетический PDF-файл.");
      return;
    }
    if (file.size > MAX_SYNTHETIC_PDF_BYTES) {
      setDocumentError("Файл больше 5 МБ. Выберите синтетический PDF меньшего размера.");
      return;
    }

    const fingerprint = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (uploadAttempt.current?.fingerprint !== fingerprint) {
      uploadAttempt.current = { fingerprint, key: crypto.randomUUID() };
    }

    setUploadPending(true);
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await apiRequest<DocumentResponse>(
        `/v1/families/${encodeURIComponent(family.id)}/profiles/${encodeURIComponent(profile.id)}/documents`,
        {
          method: "POST",
          headers: { "Idempotency-Key": uploadAttempt.current.key },
          body,
        },
      );
      uploadAttempt.current = null;
      router.push(documentPath(family.id, profile.id, response.document.id));
    } catch (error) {
      if (error instanceof ApiError && [400, 409, 413, 415].includes(error.status)) {
        uploadAttempt.current = null;
      }
      setDocumentError(uploadErrorCopy(error));
    } finally {
      setUploadPending(false);
    }
  }

  return (
    <section className="profile-shell" aria-labelledby="profile-title">
      <div className="profile-heading">
        <div>
          <p className="context-line">
            <span>{family.displayName}</span>
            <span aria-hidden="true">/</span>
            <span>{profile.kind === "dependent" ? "Зависимый профиль" : "Взрослый профиль"}</span>
          </p>
          <h1 id="profile-title">{profile.displayName}</h1>
          <p className="profile-owner">Пространство владельца: {session.user.displayName}</p>
        </div>

        <label className="profile-switcher">
          <span>Активный профиль</span>
          <select
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
      </div>

      {error !== null && !addProfileOpen ? (
        <p className="form-error workspace-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="profile-workspace">
        <div className="profile-workspace__main">
          {requestedDocumentId === undefined ? (
            <>
              <DocumentInbox
                pending={uploadPending}
                error={documentError}
                onSubmit={handleDocumentUpload}
              />
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
            </>
          ) : (
            <DocumentView family={family} profile={profile} documentId={requestedDocumentId} />
          )}
        </div>

        <aside className="workspace-rail" aria-label="Действия с профилем">
          {requestedDocumentId !== undefined ? (
            <div className="rail-section">
              <h2>Другой документ</h2>
              <p>Вернитесь в профиль, чтобы загрузить следующий синтетический PDF.</p>
              <Link className="button button--secondary" href={profilePath(family.id, profile.id)}>
                Загрузить ещё документ
              </Link>
            </div>
          ) : null}

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
            <FamilyAuditLogPanel key={`audit:${family.id}`} familyId={family.id} />
          ) : null}
        </aside>
      </div>
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
    "family.audit_log.opened": "Открыт журнал действий",
    "family.created": "Создана семья",
    "indicator.catalog.opened": "Открыт каталог показателей",
    "indicator.series.opened": "Открыта динамика показателя",
    "observation.history.opened": "Открыта история подтверждённых значений",
    "profile.created": "Создан профиль",
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

function uploadErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Не удалось загрузить документ. Проверьте соединение и повторите попытку.";
  }
  if (error.status === 415) {
    return "Файл не похож на поддерживаемый PDF. Проверьте его формат и содержимое.";
  }
  if (error.status === 413) {
    return "Файл больше 5 МБ. Выберите синтетический PDF меньшего размера.";
  }
  if (error.status === 409) {
    return "Эта попытка загрузки уже относится к другому файлу. Выберите файл заново.";
  }
  if (error.status === 400) {
    return "Нужен ровно один синтетический PDF-файл.";
  }
  if (error.status === 401 || error.status === 404) {
    return "Профиль недоступен. Обновите страницу и проверьте активный профиль.";
  }
  return "Не удалось загрузить документ. Данные не изменились; попробуйте ещё раз.";
}

interface DocumentInboxProps {
  pending: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function DocumentInbox({ pending, error, onSubmit }: DocumentInboxProps) {
  return (
    <section className="document-inbox" aria-labelledby="document-inbox-title">
      <span className="source-mark" aria-hidden="true">
        PDF
      </span>
      <p className="context-line">Исходные документы</p>
      <h2 id="document-inbox-title">Добавьте синтетический PDF</h2>
      <p className="document-intro">
        Мы сохраним исходные байты без изменений и рассчитаем SHA-256. Затем локальная
        детерминированная обработка поставит в очередь черновое извлечение значений для проверки.
      </p>

      <div className="synthetic-reminder" role="note">
        <strong>Не загружайте реальные медицинские данные.</strong>
        <span> Контур принимает только вымышленные PDF до 5 МБ.</span>
      </div>

      <form className="upload-form" onSubmit={onSubmit} aria-busy={pending}>
        <label className="file-field">
          <span>Синтетический PDF</span>
          <input
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
            disabled={pending}
            aria-describedby="pdf-requirements"
          />
        </label>
        <p id="pdf-requirements" className="form-note">
          Один PDF, не больше 5 МБ. Имя файла используется только для отображения.
        </p>
        {error !== null ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "Сохраняем исходник…" : "Загрузить PDF"}
        </button>
        {pending ? (
          <p className="form-note" role="status">
            Загружаем и проверяем PDF…
          </p>
        ) : null}
      </form>
    </section>
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
              items: [...current.items, ...response.items],
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
          Исходный фрагмент и ссылка на PDF остаются рядом с каждым значением. Тенденции и
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
            <p className="observation-history__fragment-label">Фрагмент из исходного PDF</p>
            <pre className="observation-history__fragment">
              <code>{item.sourceDocument.fragment}</code>
            </pre>
            <a
              className="observation-history__source-link"
              href={observationSourceHref(item.sourceDocument.contentPath)}
              download
            >
              Открыть исходный PDF
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
            <a href={observationSourceHref(item.sourceDocument.contentPath)}>Источник · PDF</a>
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
}

function DocumentView({ family, profile, documentId }: DocumentViewProps) {
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
        <Link className="button button--secondary" href={profilePath(family.id, profile.id)}>
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
      <Link className="back-link" href={profilePath(family.id, profile.id)}>
        ← {profile.displayName}
      </Link>
      <p className="document-state">
        <span aria-hidden="true" />
        Исходник сохранён без изменений
      </p>
      <h2 id="document-title">{savedDocument.originalFilename}</h2>
      <p className="document-meta">
        PDF · {formatBytes(savedDocument.byteSize)} · {formatDate(savedDocument.uploadedAt)}
      </p>

      {savedDocument.duplicate.possible ? (
        <div className="duplicate-note" role="status">
          <strong>Возможный дубликат</strong>
          <p>SHA-256 совпадает с ранее загруженным документом этой семьи.</p>
        </div>
      ) : null}

      <div className="document-actions">
        <a className="button button--primary" href={contentUrl} download>
          Скачать исходный PDF
        </a>
      </div>

      <DocumentProcessingPanel
        familyId={family.id}
        profileId={profile.id}
        document={savedDocument}
      />
    </section>
  );
}

interface DocumentProcessingPanelProps {
  familyId: string;
  profileId: string;
  document: DocumentSummary;
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

function processingFailureCopy(
  status: Extract<DocumentProcessingStatus, { state: "failed" }>,
): string {
  switch (status.category) {
    case "document_unavailable":
      return "Исходный PDF сейчас недоступен обработчику. Сам файл не менялся.";
    case "invalid_document":
      return "Документ нельзя обработать безопасно. Исходный PDF сохранён без изменений.";
    case "unsupported_document":
      return "Этот вариант PDF пока не поддерживается детерминированным извлечением.";
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
        copy: "Исходный PDF сохранён без изменений. Статус появится после следующего обновления.",
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
        heading: "Извлекаем текст из PDF",
        copy: "Используем детерминированный локальный обработчик. Медицинские выводы не формируются.",
        integrityLabel: "Извлечение текста",
        mark: "…",
        tone: "active",
      };
    case "document_classification":
      return {
        heading: "Проверяем тип документа",
        copy: "Сверяем документ с ограниченным синтетическим форматом этого контура.",
        integrityLabel: "Проверка типа",
        mark: "…",
        tone: "active",
      };
    case "structured_extraction":
      return {
        heading: "Готовим черновые значения",
        copy: "Связываем каждое значение со страницей и фрагментом исходного PDF.",
        integrityLabel: "Структурирование",
        mark: "…",
        tone: "active",
      };
    case "validation":
      return {
        heading: "Проверяем черновой результат",
        copy: "Проверяем формат, источник и ограничения перед тем, как показать значения для проверки.",
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
      setRetryError(
        "Не удалось запустить повторную обработку. Статус и исходный PDF не изменились.",
      );
    } finally {
      setRetryPending(false);
    }
  }

  const presentation = processingPresentation(processing);
  const showRetry = processing.state === "failed" && processing.retryAllowed;

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
              Не удалось обновить статус. Исходный PDF не изменён.
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

      {processing.state === "awaiting_review" || processing.state === "completed" ? (
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

  async function submitDecision(fact: ReviewFact, command: ReviewCommand): Promise<void> {
    const fingerprint = JSON.stringify(command);
    const previousAttempt = commandAttempts.current.get(fact.id);
    const attempt =
      previousAttempt?.fingerprint === fingerprint
        ? previousAttempt
        : { fingerprint, key: crypto.randomUUID() };
    commandAttempts.current.set(fact.id, attempt);
    setPendingFactId(fact.id);
    setReviewError(null);
    setReviewNotice(null);

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
      const nextStatus: ReviewFactStatus = command.decision === "reject" ? "rejected" : "confirmed";
      setFacts((current) =>
        current.kind !== "ready"
          ? current
          : {
              kind: "ready",
              items: current.items.map((item) =>
                item.id === fact.id ? { ...item, reviewStatus: nextStatus } : item,
              ),
            },
      );
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
      if (error instanceof ApiError && error.status < 500) {
        commandAttempts.current.delete(fact.id);
      }
      setReviewError({ factId: fact.id, copy: reviewErrorCopy(error) });
    } finally {
      setPendingFactId(null);
    }
  }

  return (
    <section
      className="document-review"
      aria-labelledby="document-review-title"
      aria-busy={facts.kind === "loading" || pendingFactId !== null}
    >
      <div className="document-review__heading">
        <p className="context-line">Проверка источника</p>
        <h3 id="document-review-title">Проверьте извлечённые значения</h3>
        <p>
          Автоматическое извлечение остаётся черновиком, пока вы не сверите его со страницей и не
          выберете действие. Здесь нет медицинской интерпретации.
        </p>
        <Link
          className="document-review__history-link"
          href={`${profilePath(familyId, profileId)}#observation-history`}
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
          <p>Черновые значения сейчас не загрузились. Исходный PDF и решения не изменены.</p>
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
              anyPending={pendingFactId !== null}
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
          <p className="review-fact__provenance">Фрагмент из исходного PDF</p>
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
