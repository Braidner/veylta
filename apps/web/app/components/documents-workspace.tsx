"use client";

import type { DocumentSummary, ProfileOverviewResponse } from "@veylta/contracts";
import { FileUp, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../api-client";
import { queueCounts, queueRows } from "../document-queue";
import { searchNodes, timelineNodes } from "../document-timeline";
import {
  archiveDocumentCountCopy,
  buildDocumentSearchPath,
  buildDocumentsArchiveHero,
  normalizeDocumentSearchResponse,
  restartTargets,
} from "../documents-archive";
import { useArchiveActions } from "../use-archive-actions";
import { useDocumentTimeline } from "../use-document-timeline";
import { DocumentExports } from "./document-exports";
import { DocumentQueue } from "./document-queue";
import { DocumentTimeline } from "./document-timeline";
import { DocumentsHero } from "./documents-hero";

type SearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; documents: readonly DocumentSummary[] }
  | { kind: "error"; query: string };

/** The documents page: the one-line hero, the exports, the queue, then the timeline; search shows hits as nodes. */
export function DocumentsWorkspace({
  familyId,
  profileId,
  canWrite,
  overview,
  onReload,
  onUpload,
}: {
  readonly familyId: string;
  readonly profileId: string;
  readonly canWrite: boolean;
  readonly overview: ProfileOverviewResponse;
  readonly onReload: () => Promise<void>;
  readonly onUpload: () => void;
}) {
  const rows = queueRows(overview);
  const counts = queueCounts(overview);
  const archive = useArchiveActions({ familyId, profileId, reload: onReload });
  // Reviewed documents are exactly what the timeline holds, so their number is its revision: it
  // changes when one leaves the queue and when one is deleted, and both must reach the lane below.
  const timeline = useDocumentTimeline({
    familyId,
    profileId,
    revision: counts.total - counts.inQueue,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  const [searchRevision, setSearchRevision] = useState(0);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setSearchState({ kind: "loading", query });
    const timeout = window.setTimeout(
      () => {
        void apiRequest<unknown>(buildDocumentSearchPath(familyId, profileId, query), {
          signal: controller.signal,
        })
          .then((response) => {
            if (!controller.signal.aborted) {
              setSearchState({
                kind: "ready",
                query,
                documents: normalizeDocumentSearchResponse(response),
              });
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) setSearchState({ kind: "error", query });
          });
      },
      searchRevision === 0 ? 260 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [familyId, profileId, searchQuery, searchRevision]);

  return (
    <>
      <DocumentsHero
        canWrite={canWrite}
        summary={buildDocumentsArchiveHero(overview, counts.inQueue)}
        bulkConfirmPending={archive.action.kind === "confirming"}
        bulkConfirmProgress={
          archive.action.kind === "confirming" && archive.action.documentId === null
            ? `Подтверждаем ${archive.action.completed} из ${archive.action.total}…`
            : null
        }
        bulkConfirmError={archive.action.kind === "error" ? archive.action.copy : null}
        restartAllPending={archive.action.kind === "restarting"}
        searchQuery={searchQuery}
        onSearchChange={(query) => {
          setSearchRevision(0);
          setSearchQuery(query);
        }}
        onUpload={onUpload}
        onConfirmAll={() => void archive.confirmDocuments(overview.reviewQueue.documents)}
        onRestartFailed={() => void archive.restartDocuments(restartTargets(overview))}
      />
      {canWrite ? <DocumentExports familyId={familyId} profileId={profileId} /> : null}
      {searchState.kind === "idle" && counts.total === 0 ? (
        <div className="profile-overview__empty" role="status">
          <p>
            Исходников пока нет. Загрузите PDF, PNG или JPEG — до 20 файлов по 5 МБ за раз. Codex
            подготовит значения для вашей проверки, а оригиналы останутся неизменными.
          </p>
          {canWrite ? (
            <button className="button button--secondary" type="button" onClick={onUpload}>
              <FileUp size={16} aria-hidden="true" />
              Загрузить первый документ
            </button>
          ) : null}
        </div>
      ) : null}
      {searchState.kind === "idle" && counts.total > 0 ? (
        <>
          <DocumentQueue
            rows={rows}
            canWrite={canWrite}
            action={archive.action}
            onRestart={(row) => void archive.restartDocuments([row.document])}
          />
          {timeline.state.kind === "loading" ? (
            <p className="document-timeline__loading" aria-live="polite">
              Собираем ленту…
            </p>
          ) : null}
          {timeline.state.kind === "error" ? (
            <div className="profile-overview__empty" role="status">
              <p>Не удалось загрузить ленту. Очередь выше актуальна.</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void timeline.reload()}
              >
                Повторить
              </button>
            </div>
          ) : null}
          {timeline.state.kind === "ready" ? (
            <DocumentTimeline
              nodes={timelineNodes(timeline.state.entries)}
              grouped
              canWrite={canWrite}
              nextBefore={timeline.state.nextBefore}
              loadingMore={timeline.state.loadingMore}
              onLoadMore={() => void timeline.loadMore()}
              onCorrectDate={timeline.correctDate}
            />
          ) : null}
        </>
      ) : null}
      {searchState.kind === "loading" ? (
        <div className="document-search-state" role="status">
          <span className="document-search-state__spinner" aria-hidden="true" />
          <div>
            <strong>Ищем по саммари и результатам</strong>
            <p>Запрос «{searchState.query}» проверяется в локальном архиве.</p>
          </div>
        </div>
      ) : null}
      {searchState.kind === "error" ? (
        <div className="document-search-state document-search-state--error" role="alert">
          <div>
            <strong>Поиск временно недоступен</strong>
            <p>Архив не изменён. Можно повторить тот же запрос.</p>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setSearchRevision((current) => current + 1)}
          >
            Повторить
          </button>
        </div>
      ) : null}
      {searchState.kind === "ready" && searchState.documents.length === 0 ? (
        <div className="profile-overview__empty document-search-empty" role="status">
          <Search size={20} aria-hidden="true" />
          <p>По запросу «{searchState.query}» ничего не найдено.</p>
          <button
            className="text-link text-link--button"
            type="button"
            onClick={() => setSearchQuery("")}
          >
            Показать весь архив
          </button>
        </div>
      ) : null}
      {searchState.kind === "ready" && searchState.documents.length > 0 ? (
        <DocumentTimeline
          nodes={searchNodes(searchState.documents)}
          grouped={false}
          canWrite={false}
          nextBefore={null}
          loadingMore={false}
          onLoadMore={() => undefined}
          onCorrectDate={async () => undefined}
          heading={{
            title: archiveDocumentCountCopy(searchState.documents.length),
            note: `Результаты поиска по запросу «${searchState.query}».`,
          }}
        />
      ) : null}
    </>
  );
}
