import type { ProfileOverviewResponse } from "@veylta/contracts";
import { cva } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  CircleAlert,
  ClipboardCheck,
  FileText,
  MessagesSquare,
  PersonStanding,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { cn } from "../lib/cn";
import type {
  DashboardAssistant,
  DashboardAssistantId,
  DashboardSignal,
  ProfileDashboardModel,
} from "../profile-dashboard";
import { buildProfileDashboardModel } from "../profile-dashboard";
import { DashboardTools } from "./dashboard-tools";

const assistantIcons: Record<DashboardAssistantId, LucideIcon> = {
  physician: Stethoscope,
  nutrition: Utensils,
  movement: PersonStanding,
};

const signalIcons: Record<keyof ProfileDashboardModel["signals"], LucideIcon> = {
  pendingReview: ClipboardCheck,
  sourceFlags: CircleAlert,
  sources: FileText,
  confirmed: BadgeCheck,
};

const signalClassName = cva("health-signal", {
  variants: {
    tone: {
      neutral: "health-signal--neutral",
      positive: "health-signal--positive",
      attention: "health-signal--attention",
    },
  },
  defaultVariants: { tone: "neutral" },
});

function AssistantAction({
  assistant,
  primary,
  onUpload,
}: {
  assistant: DashboardAssistant;
  primary: boolean;
  onUpload: () => void;
}) {
  const className = cn("assistant-card__action", primary && "assistant-card__action--primary");
  const content = (
    <>
      <span>{assistant.action.label}</span>
      <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
    </>
  );

  return assistant.action.href === "#document-inbox-title" ? (
    <button className={className} type="button" onClick={onUpload}>
      {content}
    </button>
  ) : assistant.action.href.startsWith("/") ? (
    <Link className={className} href={assistant.action.href}>
      {content}
    </Link>
  ) : (
    <a className={className} href={assistant.action.href}>
      {content}
    </a>
  );
}

function AssistantCard({
  assistant,
  primary = false,
  onUpload,
}: {
  assistant: DashboardAssistant;
  primary?: boolean;
  onUpload: () => void;
}) {
  const AssistantIcon = assistantIcons[assistant.id];
  return (
    <article
      className={cn("assistant-card", primary && "assistant-card--primary")}
      data-assistant={assistant.id}
    >
      <div className="assistant-card__identity">
        <span className="assistant-card__icon" aria-hidden="true">
          <AssistantIcon size={22} strokeWidth={1.8} />
        </span>
        <div>
          <h4>{assistant.label}</h4>
          <p>{assistant.role}</p>
        </div>
      </div>
      <p className="assistant-card__message">{assistant.message}</p>
      <div className="assistant-card__footer">
        <span>{assistant.meta}</span>
        <AssistantAction assistant={assistant} primary={primary} onUpload={onUpload} />
      </div>
    </article>
  );
}

function HealthSignal({ signal, icon: SignalIcon }: { signal: DashboardSignal; icon: LucideIcon }) {
  return (
    <article className={signalClassName({ tone: signal.tone })}>
      <div className="health-signal__topline">
        <span className="health-signal__icon" aria-hidden="true">
          <SignalIcon size={18} strokeWidth={1.8} />
        </span>
        <span>{signal.label}</span>
      </div>
      <strong>{signal.value}</strong>
      <p>{signal.detail}</p>
    </article>
  );
}

function documentHref(familyId: string, profileId: string, documentId: string): string {
  return `/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/documents/${encodeURIComponent(documentId)}`;
}

function documentStateCopy(
  state: ProfileOverviewResponse["recentDocuments"][number]["processing"]["state"],
): string {
  switch (state) {
    case "completed":
      return "Проверено";
    case "awaiting_review":
      return "Нужна проверка";
    case "failed":
      return "Не обработан";
    case "not_started":
    case "queued":
      return "Ожидает обработки";
    default:
      return "Обработка";
  }
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function DashboardDocuments({
  overview,
  onUpload,
}: {
  overview: ProfileOverviewResponse;
  onUpload: () => void;
}) {
  const documents = overview.recentDocuments.slice(0, 3);
  return (
    <section className="dashboard-documents" aria-labelledby="dashboard-documents-title">
      <div className="dashboard-card-heading">
        <span aria-hidden="true">
          <FileText size={20} strokeWidth={1.8} />
        </span>
        <h3 id="dashboard-documents-title">Последний документ</h3>
        <button type="button" onClick={onUpload} aria-label="Загрузить новый документ">
          <ArrowUpRight size={18} aria-hidden="true" />
        </button>
      </div>

      {documents.length === 0 ? (
        <div className="dashboard-documents__empty">
          <p>Архив пока пуст</p>
          <span>Добавьте первый синтетический источник — оригинал останется локально.</span>
          <button type="button" onClick={onUpload}>
            Загрузить первый документ
          </button>
        </div>
      ) : (
        <ol className="dashboard-documents__list">
          {documents.map((document, index) => (
            <li key={document.id} data-primary={index === 0 ? "true" : undefined}>
              <Link
                href={documentHref(overview.profile.familyId, overview.profile.id, document.id)}
              >
                <span className="dashboard-documents__file" aria-hidden="true">
                  <FileText size={17} strokeWidth={1.8} />
                </span>
                <span>
                  <strong>{document.originalFilename}</strong>
                  <small>{formatShortDate(document.uploadedAt)}</small>
                </span>
                <em>{documentStateCopy(document.processing.state)}</em>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function currentWeek(): ReadonlyArray<{ label: string; date: number; active: boolean }> {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const labels = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
  return labels.map((label, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { label, date: date.getDate(), active: date.toDateString() === today.toDateString() };
  });
}

function DashboardPlan({ href }: { href: string }) {
  return (
    <section className="dashboard-plan" aria-label="Календарь и быстрый доступ к плану">
      <div className="dashboard-card-heading">
        <span aria-hidden="true">
          <CalendarDays size={20} strokeWidth={1.8} />
        </span>
        <h3 id="dashboard-plan-title">План заботы</h3>
        <Link href={href} aria-label="Открыть план заботы">
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </div>

      <ol className="dashboard-plan__week" aria-label="Текущая неделя">
        {currentWeek().map((day) => (
          <li key={day.label} data-active={day.active ? "true" : undefined}>
            <small>{day.label}</small>
            <strong>{day.date}</strong>
          </li>
        ))}
      </ol>

      <div className="dashboard-plan__empty">
        <span aria-hidden="true" />
        <p>
          <strong>Ваши действия — только после подтверждения</strong>
          <small>Черновики помощников не становятся назначениями автоматически.</small>
        </p>
      </div>

      <Link className="dashboard-plan__source" href={href}>
        <span>
          <strong>Источник всегда рядом</strong>
          <small>Каждый пункт связан с подтверждёнными данными</small>
        </span>
        <ShieldCheck size={20} aria-hidden="true" />
      </Link>
    </section>
  );
}

export function ProfileDashboard({
  overview,
  onUpload,
}: {
  overview: ProfileOverviewResponse;
  onUpload: () => void;
}) {
  const model = buildProfileDashboardModel(overview);
  const profileHref = `/families/${encodeURIComponent(overview.profile.familyId)}/profiles/${encodeURIComponent(overview.profile.id)}`;
  const historyHref = `${profileHref}?tab=history`;
  const planHref = `${profileHref}?tab=plan`;
  const signals = Object.entries(model.signals) as Array<
    [keyof ProfileDashboardModel["signals"], DashboardSignal]
  >;

  return (
    <div className="profile-dashboard">
      <section className="assistant-hub" aria-labelledby="assistant-hub-title">
        <div className="dashboard-panel-heading">
          <div className="dashboard-panel-heading__icon" aria-hidden="true">
            <MessagesSquare size={21} strokeWidth={1.8} />
          </div>
          <div>
            <p>Сообщения по вашим данным</p>
            <h3 id="assistant-hub-title">Помощники</h3>
          </div>
          <span className="assistant-hub__boundary">
            <Sparkles size={14} aria-hidden="true" />
            Не заменяют специалиста
          </span>
        </div>

        <AssistantCard assistant={model.assistants[0]} primary onUpload={onUpload} />
        <div className="assistant-hub__secondary">
          <AssistantCard assistant={model.assistants[1]} onUpload={onUpload} />
          <AssistantCard assistant={model.assistants[2]} onUpload={onUpload} />
        </div>
      </section>

      <DashboardTools historyHref={historyHref} />

      <section className="health-signals" aria-labelledby="health-signals-title">
        <div className="dashboard-panel-heading">
          <div className="dashboard-panel-heading__icon" aria-hidden="true">
            <Activity size={21} strokeWidth={1.8} />
          </div>
          <div>
            <p>Что требует внимания</p>
            <h3 id="health-signals-title">Сигналы здоровья</h3>
          </div>
          <span className="health-signals__boundary">Без общего балла</span>
        </div>

        <div className="health-signals__grid">
          {signals.map(([key, signal]) => (
            <HealthSignal key={key} signal={signal} icon={signalIcons[key]} />
          ))}
        </div>
        <p className="health-signals__note">
          Это состояние архива и явные отметки источников — не диагноз, риск или медицинская оценка.
        </p>
      </section>

      <DashboardDocuments overview={overview} onUpload={onUpload} />
      <DashboardPlan href={planHref} />
    </div>
  );
}
