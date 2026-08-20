"use client";

import type { CarePlanResponse } from "@veylta/contracts";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api-client";
import { localDateOf } from "../care-plan-checkins";
import { buildDashboardPlan, type DashboardPlanModel } from "../dashboard-plan";
import { carePlanApiPath } from "../paths";
import { DashboardToday } from "./dashboard-today";

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

type PlanState =
  | { kind: "loading" }
  | { kind: "ready"; model: DashboardPlanModel; today: string; canWrite: boolean }
  | { kind: "error" };

function PlanBody({
  state,
  href,
  carePlanPath,
  onRecorded,
}: {
  state: PlanState;
  href: string;
  carePlanPath: string;
  onRecorded: () => Promise<void>;
}) {
  if (state.kind === "error") {
    return (
      <p className="dashboard-plan__note" role="status">
        План не загрузился. Откройте его целиком, чтобы увидеть принятые пункты.
      </p>
    );
  }
  if (state.kind === "loading") return <p className="dashboard-plan__note">Загружаем план…</p>;

  const { model } = state;
  if (model.today.length === 0 && model.scheduled.length === 0 && model.proposals === null)
    return <p className="dashboard-plan__note">В плане пока ничего нет</p>;

  return (
    <div className="dashboard-plan__body">
      <DashboardToday
        rows={model.today}
        more={model.todayMore}
        carePlanPath={carePlanPath}
        today={state.today}
        canWrite={state.canWrite}
        href={href}
        onRecorded={onRecorded}
      />
      {model.proposals === null ? null : (
        <p className="dashboard-plan__proposals">
          <Link href={href}>{model.proposals}</Link>
        </p>
      )}
      {model.scheduled.length === 0 ? null : (
        <ul className="dashboard-plan__items" aria-label="Принятые пункты плана">
          {model.scheduled.map((row) => (
            <li key={row.id}>
              <Link href={href}>
                <span className="dashboard-plan__lane">{row.lane}</span>
                <strong>{row.title}</strong>
                <small>
                  {row.when}
                  {row.checkin === null ? null : <i>{row.checkin}</i>}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The plan on the overview: the week, «Сегодня» — the accepted regimen the person marks right here
 * —, the drafts still waiting for a decision, then the nearest dated actions. Nothing is ever
 * accepted from here. The care plan is its own request, so a plan that fails to load costs this
 * block its list and nothing else on the dashboard.
 */
export function DashboardPlan({
  familyId,
  profileId,
  canWriteProfile,
  href,
}: {
  familyId: string;
  profileId: string;
  canWriteProfile: boolean;
  href: string;
}) {
  const [state, setState] = useState<PlanState>({ kind: "loading" });
  const carePlanPath = carePlanApiPath(familyId, profileId);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await apiRequest<CarePlanResponse>(
          carePlanApiPath(familyId, profileId),
          signal === undefined ? undefined : { signal },
        );
        if (signal?.aborted) return;
        const today = localDateOf(new Date());
        setState({
          kind: "ready",
          model: buildDashboardPlan(response.items, today),
          today,
          canWrite: response.canWrite && canWriteProfile,
        });
      } catch {
        if (!signal?.aborted) setState({ kind: "error" });
      }
    },
    [canWriteProfile, familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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

      <PlanBody state={state} href={href} carePlanPath={carePlanPath} onRecorded={load} />

      <p className="dashboard-plan__promise">
        Черновики помощников не становятся назначениями автоматически.
      </p>
    </section>
  );
}
