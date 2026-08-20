import type { ProfileOverviewResponse } from "@veylta/contracts";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
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
import { documentPath, profileTabPath } from "../paths";
import type { DashboardAssistant, DashboardAssistantId } from "../profile-dashboard";
import { buildProfileDashboardModel } from "../profile-dashboard";
import { DashboardPlan } from "./dashboard-plan";
import { HealthSignals } from "./health-signals";

const assistantIcons: Record<DashboardAssistantId, LucideIcon> = {
  physician: Stethoscope,
  nutrition: Utensils,
  movement: PersonStanding,
};

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
        {assistant.meta === null ? null : <span>{assistant.meta}</span>}
        <AssistantAction assistant={assistant} primary={primary} onUpload={onUpload} />
      </div>
    </article>
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
  canWriteProfile,
  onUpload,
}: {
  overview: ProfileOverviewResponse;
  canWriteProfile: boolean;
  onUpload: () => void;
}) {
  const model = buildProfileDashboardModel(overview);
  const { handle } = overview.profile;

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

      <HealthSignals overview={overview} />

      <DashboardDocuments overview={overview} onUpload={onUpload} />
      <DashboardPlan
        familyId={overview.profile.familyId}
        profileId={overview.profile.id}
        canWriteProfile={canWriteProfile}
        href={profileTabPath(handle, "dossier")}
      />
    </div>
  );
}
