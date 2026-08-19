"use client";

import type { CarePlanItemResponse } from "@veylta/contracts";
import { ArrowRight, CalendarPlus, CircleCheck, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { apiRequest } from "../api-client";
import { specialtyLabel } from "../assistant";
import type { AttentionGroup } from "../dossier";
import { askQuestion, type DossierAsk, stashDossierAsk } from "../dossier-ask";
import { assistantAskPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { countCopy } from "../russian-plural";
import { GaugeCard } from "./dossier-gauge";

interface DossierAttentionProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly groups: readonly AttentionGroup[];
  readonly totalSeries: number;
  readonly loading: boolean;
  readonly canWrite: boolean;
  /** Whole-record views name each card's area; an area view already says it in its heading. */
  readonly showArea: boolean;
  readonly onPlanned: () => void;
}

/** One visit per specialty group goes into the plan's clinician lane; the item id is stable per group. */
function useVisitPlanning(familyId: string, profileId: string, onPlanned: () => void) {
  const [planned, setPlanned] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemIds = useRef(new Map<string, string>());
  async function plan(key: string, title: string, note: string): Promise<void> {
    if (pending !== null) return;
    const itemId = itemIds.current.get(key) ?? crypto.randomUUID();
    itemIds.current.set(key, itemId);
    setPending(key);
    setError(null);
    try {
      await apiRequest<CarePlanItemResponse>(
        `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/care-plan/items/${itemId}`,
        {
          method: "PUT",
          body: JSON.stringify({ category: "clinician", title, note, scheduledFor: null }),
        },
      );
      setPlanned((current) => new Set([...current, key]));
      onPlanned();
    } catch {
      setError("Не удалось добавить визит в план. Повторите попытку.");
    } finally {
      setPending(null);
    }
  }
  return { planned, pending, error, plan };
}

/**
 * What deserves a look now: every indicator outside its printed range as a gauge card, grouped
 * by the specialty that reads it, each group with two ways forward — put the visit into the
 * plan, or ask the assistant how urgent it is. Veylta names the facts and the doctor; it does
 * not grade the finding.
 */
export function DossierAttention({
  familyId,
  profileId,
  groups,
  totalSeries,
  loading,
  canWrite,
  showArea,
  onPlanned,
}: DossierAttentionProps) {
  const handle = useProfileHandle();
  const visits = useVisitPlanning(familyId, profileId, onPlanned);
  const outside = groups.reduce((sum, group) => sum + group.series.length, 0);
  return (
    <section
      className={`dossier-attention${outside === 0 ? " is-calm" : " is-watch"}`}
      aria-labelledby="dossier-attention-title"
      data-testid="dossier-attention"
    >
      <div className="dossier-section__heading">
        <h3 id="dossier-attention-title">
          {loading
            ? "Оцениваем значения…"
            : outside === 0
              ? "Требующих внимания нет"
              : `Требуют внимания: ${countCopy(outside, ["показатель", "показателя", "показателей"])}`}
        </h3>
        <span>по референсам лабораторий</span>
      </div>
      {!loading && outside === 0 && totalSeries > 0 ? (
        <p className="dossier-attention__calm">
          <CircleCheck size={18} aria-hidden="true" />
          Ни одно подтверждённое значение здесь не выходит за референс своей лаборатории. Это не
          заключение врача — но повода для срочного визита в самих числах нет.
        </p>
      ) : null}
      <ul className="dossier-attention__groups">
        {groups.map((group) => {
          const key = group.specialty ?? "therapist";
          const ask: DossierAsk = group.specialty ?? "therapist";
          const who = group.specialty === null ? "терапевт" : specialtyLabel[group.specialty];
          const title = `Визит: ${who} — ${group.series.map((item) => item.name).join(", ")}`.slice(
            0,
            120,
          );
          const note = `Вне референса лаборатории: ${group.series
            .map((item) => `${item.name} ${item.latest.printed} ${item.unit}`)
            .join("; ")}.`.slice(0, 500);
          return (
            <li key={key} className="dossier-attention__group" data-specialty={key}>
              <div className="dossier-attention__who">
                <Stethoscope size={17} aria-hidden="true" />
                <strong>К специалисту: {who}</strong>
                <div className="dossier-attention__actions">
                  {canWrite ? (
                    visits.planned.has(key) ? (
                      <span className="dossier-attention__planned">
                        <CircleCheck size={15} aria-hidden="true" />В плане заботы
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={visits.pending !== null}
                        onClick={() => void visits.plan(key, title, note)}
                      >
                        <CalendarPlus size={15} aria-hidden="true" />
                        {visits.pending === key ? "Добавляем…" : "В план: визит"}
                      </button>
                    )
                  ) : null}
                  <Link
                    className="dossier-attention__ask"
                    href={assistantAskPath(handle, ask)}
                    onClick={() =>
                      stashDossierAsk(window.sessionStorage, profileId, {
                        ask,
                        question: askQuestion(ask, group.series),
                      })
                    }
                  >
                    Спросить ИИ-врача, насколько срочно
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>
              <ul className="dossier-gauges">
                {group.series.map((item) => (
                  <GaugeCard key={item.key} series={item} showArea={showArea} />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {visits.error !== null ? (
        <p className="form-error" role="alert">
          {visits.error}
        </p>
      ) : null}
    </section>
  );
}
