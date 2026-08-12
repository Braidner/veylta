"use client";

import type {
  DemoRegistrationResponse,
  DocumentResponse,
  DocumentSummary,
  PatientProfileSummary,
  ProfileCreateResponse,
  SessionFamily,
  SessionResponse,
} from "@family-health/contracts";
import { MAX_SYNTHETIC_PDF_BYTES } from "@family-health/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { SystemStatus } from "./system-status";

const apiPrefix = "/health-api";

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

interface FamilyHealthAppProps {
  requestedFamilyId?: string;
  requestedProfileId?: string;
  requestedDocumentId?: string;
}

export function FamilyHealthApp({
  requestedFamilyId,
  requestedProfileId,
  requestedDocumentId,
}: FamilyHealthAppProps) {
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
  const pageTitle =
    context === undefined ? "Family Health" : `${context.profile.displayName} — Family Health`;

  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Перейти к содержанию
      </a>
      <header className="workspace-bar">
        <Link className="wordmark" href="/" aria-label="Family Health — главная">
          <span aria-hidden="true">FH</span>
          Family Health
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
      <p className="context-line">Family Health</p>
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
        {requestedDocumentId === undefined ? (
          <DocumentInbox
            pending={uploadPending}
            error={documentError}
            onSubmit={handleDocumentUpload}
          />
        ) : (
          <DocumentView family={family} profile={profile} documentId={requestedDocumentId} />
        )}

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
        </aside>
      </div>
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
        Мы сохраним исходные байты без изменений и рассчитаем SHA-256. Извлечение медицинских
        значений на этом шаге не запускается.
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
      ? `${state.document.originalFilename} — ${profile.displayName} — Family Health`
      : `${profile.displayName} — Family Health`;
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

      <section className="processing-state" aria-labelledby="processing-title">
        <div className="processing-state__mark" aria-hidden="true">
          —
        </div>
        <div>
          <h3 id="processing-title">Извлечение не запущено</h3>
          <p>
            Сейчас доступен только неизменный исходник. Значения для проверки появятся в следующем
            вертикальном шаге.
          </p>
        </div>
      </section>

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
            <dd>Не запущена</dd>
          </div>
        </dl>
      </details>
    </section>
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
