"use client";

import type {
  ClinicianRecordDecisionRequest,
  ClinicianRecordDecisionResponse,
  ClinicianRecordsResponse,
} from "@veylta/contracts";
import { Scale } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api-client";
import { checkQuestion, recordCounts, recordCountsLine } from "../clinician-records";
import { stashDossierAsk } from "../dossier-ask";
import { assistantAskPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { type RecordDecision, RecordRow } from "./clinician-record-row";

interface ClinicianRecordsPanelProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly documentId: string;
  readonly contentUrl: string;
  readonly canWrite: boolean;
  /** Changes when the analysis changes, so the list reloads with the new statements. */
  readonly refreshKey: string;
}

export function clinicianRecordsPath(familyId: string, profileId: string, documentId: string) {
  return `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/documents/${encodeURIComponent(documentId)}/clinician-records`;
}

/**
 * The clinician's own statements read out of this document — diagnoses, prescriptions,
 * referrals, follow-ups, procedures, findings — each with its page and fragment. A person
 * confirms (as read, or in their own words) or rejects each one; only confirmed records reach
 * the assistants and the сверка. Nothing here is Veylta's opinion.
 */
export function ClinicianRecordsPanel({
  familyId,
  profileId,
  documentId,
  contentUrl,
  canWrite,
  refreshKey,
}: ClinicianRecordsPanelProps) {
  const handle = useProfileHandle();
  const [response, setResponse] = useState<ClinicianRecordsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = clinicianRecordsPath(familyId, profileId, documentId);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const loaded = await apiRequest<ClinicianRecordsResponse>(
          path,
          signal === undefined ? undefined : { signal },
        );
        if (!signal?.aborted) setResponse(loaded);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [path],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-runs the load on purpose.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const decide: RecordDecision = async (resultKey, decision, correction) => {
    if (response?.intelligenceResultId === null || response === null || pending !== null) return;
    setPending(resultKey);
    setError(null);
    const body: ClinicianRecordDecisionRequest = {
      intelligenceResultId: response.intelligenceResultId,
      decision,
      ...(correction === undefined ? {} : { correction }),
    };
    try {
      const decided = await apiRequest<ClinicianRecordDecisionResponse>(
        `${path}/${encodeURIComponent(resultKey)}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      setResponse({
        ...response,
        items: response.items.map((item) => (item.resultKey === resultKey ? decided.item : item)),
      });
    } catch {
      setError("Не удалось сохранить решение. Обновите страницу и попробуйте снова.");
    } finally {
      setPending(null);
    }
  };

  if (failed || response === null || response.items.length === 0) return null;
  const counts = recordCounts(response.items);
  return (
    <section
      className="clinician-records"
      aria-labelledby="clinician-records-title"
      data-testid="clinician-records"
    >
      <div className="document-section-heading">
        <div>
          <p className="context-line">Что написал врач</p>
          <h3 id="clinician-records-title">Записи врача</h3>
        </div>
        <span className="clinician-records__counts">{recordCountsLine(counts)}</span>
      </div>
      <p className="clinician-records__note">
        Формулировки из документа, как их прочитал Codex. Подтверждённые записи читает ИИ-врач и
        сверяет со своим чтением ваших значений; отклонённые никуда не идут.
      </p>
      <ul className="clinician-records__list">
        {response.items.map((item) => (
          <RecordRow
            key={item.resultKey}
            item={item}
            contentUrl={contentUrl}
            canWrite={canWrite}
            pending={pending === item.resultKey}
            onDecide={decide}
          />
        ))}
      </ul>
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {counts.confirmed > 0 && canWrite ? (
        <div className="clinician-records__check">
          <p>
            ИИ-врач прочитает ваши подтверждённые значения рядом с этими записями и скажет, где
            согласен, где расходится и что спросить на визите. Каждый вывод — рекомендация, не
            оценка врача.
          </p>
          <Link
            className="button button--secondary"
            href={assistantAskPath(handle, "therapist")}
            onClick={() =>
              stashDossierAsk(window.sessionStorage, profileId, {
                ask: "therapist",
                question: checkQuestion(response.items, response.documentDate),
              })
            }
          >
            <Scale size={15} aria-hidden="true" />
            Сверить с ИИ-врачом
          </Link>
        </div>
      ) : null}
    </section>
  );
}
