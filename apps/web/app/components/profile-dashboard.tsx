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
  ShieldCheck,
  Sparkles,
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

const assistantIcons: Record<DashboardAssistantId, LucideIcon> = {
  medical_navigator: ShieldCheck,
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
}: {
  assistant: DashboardAssistant;
  primary: boolean;
}) {
  const className = cn("assistant-card__action", primary && "assistant-card__action--primary");
  const content = (
    <>
      <span>{assistant.action.label}</span>
      <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
    </>
  );

  return assistant.action.href.startsWith("/") ? (
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
}: {
  assistant: DashboardAssistant;
  primary?: boolean;
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
        <AssistantAction assistant={assistant} primary={primary} />
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

export function ProfileDashboard({ model }: { model: ProfileDashboardModel }) {
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

        <AssistantCard assistant={model.assistants[0]} primary />
        <div className="assistant-hub__secondary">
          <AssistantCard assistant={model.assistants[1]} />
          <AssistantCard assistant={model.assistants[2]} />
        </div>
      </section>

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
    </div>
  );
}
