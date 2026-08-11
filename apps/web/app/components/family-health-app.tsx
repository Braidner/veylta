"use client";

import type {
  DemoRegistrationResponse,
  PatientProfileSummary,
  ProfileCreateResponse,
  SessionFamily,
  SessionResponse,
} from "@family-health/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
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
  if (init?.body !== undefined && !headers.has("content-type")) {
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

interface FamilyHealthAppProps {
  requestedFamilyId?: string;
  requestedProfileId?: string;
}

export function FamilyHealthApp({ requestedFamilyId, requestedProfileId }: FamilyHealthAppProps) {
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
  addProfileOpen,
  action,
  error,
  onProfileChange,
  onAddProfileToggle,
  onAddProfile,
}: ProfileWorkspaceProps) {
  const profiles = session.families.flatMap((sessionFamily) => sessionFamily.profiles);
  const ownerCanAddProfile = family.role === "owner";

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

      <div className="empty-history">
        <div className="empty-history__content">
          <span className="source-mark" aria-hidden="true">
            01
          </span>
          <p className="eyebrow">Профиль готов</p>
          <h2>История пока пуста</h2>
          <p>
            Здесь появятся только подтверждённые значения со ссылкой на исходный документ. Загрузка
            откроется в следующем узком шаге.
          </p>
          <p className="synthetic-reminder">
            <strong>Не загружайте реальные данные.</strong> Текущий контур предназначен только для
            синтетической проверки.
          </p>
        </div>

        {ownerCanAddProfile ? (
          <div className="profile-addition">
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
      </div>
    </section>
  );
}
