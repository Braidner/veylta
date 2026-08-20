import type { ProfileOverviewResponse } from "@veylta/contracts";
import { cva } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  CircleAlert,
  ClipboardCheck,
  FileText,
  MessagesSquare,
  PersonStanding,
  Sparkles,
  Stethoscope,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { documentKindLine, documentStandingCopy } from "../dashboard-documents";
import { cn } from "../lib/cn";
import { documentPath, historyPath, profileTabPath } from "../paths";
import type {
  DashboardAssistant,
  DashboardAssistantId,
  DashboardSignal,
  DashboardSignalKey,
} from "../profile-dashboard";
import { buildProfileDashboardModel, signalHref } from "../profile-dashboard";
import { DashboardAttention } from "./dashboard-attention";
import { DashboardPlan } from "./dashboard-plan";
import { DashboardTools } from "./dashboard-tools";

const assistantIcons: Record<DashboardAssistantId, LucideIcon> = {
  physician: Stethoscope,
  nutrition: Utensils,
  movement: PersonStanding,
};

const signalIcons: Record<DashboardSignalKey, LucideIcon> = {
  pendingReview: ClipboardCheck,
  outside: CircleAlert,
  documents: FileText,
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

function HealthSignal({
  signal,
  icon: SignalIcon,
  href,
}: {
  signal: DashboardSignal;
  icon: LucideIcon;
  href: string | null;
}) {
  const body = (
    <>
      <div className="health-signal__topline">
        <span className="health-signal__icon" aria-hidden="true">
          <SignalIcon size={18} strokeWidth={1.8} />
        </span>
        <span>{signal.label}</span>
      </div>
      <strong>{signal.value}</strong>
      <p>{signal.detail}</p>
    </>
  );

  // A tile that leads somewhere is one link, so the whole card is the target and takes focus once.
  return href === null ? (
    <article className={signalClassName({ tone: signal.tone })}>{body}</article>
  ) : (
    <Link className={cn(signalClassName({ tone: signal.tone }), "health-signal--link")} href={href}>
      {body}
    </Link>
  );
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
        <h3 id="dashboard-documents-title">Последние документы</h3>
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
              <Link href={documentPath(overview.profile.handle, document.id)}>
                <span className="dashboard-documents__file" aria-hidden="true">
                  <FileText size={17} strokeWidth={1.8} />
                </span>
                <span>
                  <strong>{document.intelligence?.title ?? document.originalFilename}</strong>
                  <small>{documentKindLine(document)}</small>
                </span>
                <em>{documentStandingCopy(document, overview.reviewQueue.documents)}</em>
              </Link>
            </li>
          ))}
        </ol>
      )}
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
  const { handle } = overview.profile;
  const signals = Object.entries(model.signals) as Array<[DashboardSignalKey, DashboardSignal]>;

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

      <DashboardTools historyHref={historyPath(handle)} />

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
            <HealthSignal
              key={key}
              signal={signal}
              icon={signalIcons[key]}
              href={signalHref(key, overview)}
            />
          ))}
        </div>
        <DashboardAttention overview={overview} />
        <p className="health-signals__note">
          Оценка Veylta по печатным диапазонам ваших источников, а не диагноз — каждая ведёт к
          названному специалисту.
        </p>
      </section>

      <DashboardDocuments overview={overview} onUpload={onUpload} />
      <DashboardPlan
        familyId={overview.profile.familyId}
        profileId={overview.profile.id}
        href={profileTabPath(handle, "dossier")}
      />
    </div>
  );
}
