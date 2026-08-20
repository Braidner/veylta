"use client";

import type { CarePlanResponse } from "@veylta/contracts";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../api-client";
import { localDateOf } from "../care-plan-checkins";
import { type DashboardPlanRow, dashboardPlanRows } from "../dashboard-plan";
import { carePlanApiPath } from "../paths";

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
  | { kind: "ready"; rows: readonly DashboardPlanRow[] }
  | { kind: "error" };

function PlanBody({ state, href }: { state: PlanState; href: string }) {
  if (state.kind === "error") {
    return (
      <p className="dashboard-plan__note" role="status">
        План не загрузился. Откройте его целиком, чтобы увидеть принятые пункты.
      </p>
    );
  }
  if (state.kind === "loading") return <p className="dashboard-plan__note">Загружаем план…</p>;
  if (state.rows.length === 0)
    return <p className="dashboard-plan__note">В плане пока ничего нет</p>;

  return (
    <ul className="dashboard-plan__items" aria-label="Принятые пункты плана">
      {state.rows.map((row) => (
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
  );
}

/**
 * The plan on the overview: the week, then the accepted actions themselves. Marking a day stays
 * on the plan page — here the diary is read, never written. The care plan is its own request, so
 * a plan that fails to load costs this block its list and nothing else on the dashboard.
 */
export function DashboardPlan({
  familyId,
  profileId,
  href,
}: {
  familyId: string;
  profileId: string;
  href: string;
}) {
  const [state, setState] = useState<PlanState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiRequest<CarePlanResponse>(carePlanApiPath(familyId, profileId), {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setState({
            kind: "ready",
            rows: dashboardPlanRows(response.items, localDateOf(new Date())),
          });
        }
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, [familyId, profileId]);

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

      <PlanBody state={state} href={href} />

      <p className="dashboard-plan__promise">
        Черновики помощников не становятся назначениями автоматически.
      </p>
    </section>
  );
}
