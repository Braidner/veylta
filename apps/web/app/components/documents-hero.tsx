"use client";

import { CheckCheck, FileUp, RefreshCw, Search, X } from "lucide-react";
import type { DocumentsArchiveHero } from "../documents-archive";
import { PageHero } from "./page-hero";

interface DocumentsHeroProps {
  readonly canWrite: boolean;
  /** null while the archive is still loading; the hero keeps its shape and skips counts. */
  readonly summary: DocumentsArchiveHero | null;
  readonly bulkConfirmPending: boolean;
  readonly bulkConfirmProgress: string | null;
  readonly bulkConfirmError: string | null;
  readonly restartAllPending: boolean;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly onUpload: () => void;
  readonly onConfirmAll: () => void;
  readonly onRestartFailed: () => void;
}

export function DocumentsHero({
  canWrite,
  summary,
  bulkConfirmPending,
  bulkConfirmProgress,
  bulkConfirmError,
  restartAllPending,
  searchQuery,
  onSearchChange,
  onUpload,
  onConfirmAll,
  onRestartFailed,
}: DocumentsHeroProps) {
  return (
    <PageHero
      testId="documents-hero"
      titleId="document-inbox-title"
      title="Документы профиля"
      meta="Добавьте один файл или пачку. Codex распределит документы по разделам и подготовит значения для вашей проверки, не меняя оригиналы."
      search={
        <label className="page-hero__search">
          <Search size={18} aria-hidden="true" />
          <span className="visually-hidden">Поиск по документам</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Поиск по саммари и результатам"
            autoComplete="off"
            maxLength={120}
          />
          {searchQuery.length > 0 ? (
            <button type="button" aria-label="Очистить поиск" onClick={() => onSearchChange("")}>
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </label>
      }
      actionsLabel="Действия с архивом"
      error={bulkConfirmError}
      actions={
        <>
          {canWrite ? (
            <button className="button page-hero__action" type="button" onClick={onUpload}>
              <FileUp size={17} aria-hidden="true" />
              Загрузить документы
            </button>
          ) : null}

          {canWrite && summary !== null && summary.bulkConfirmableCount > 0 ? (
            <button
              className="button page-hero__action"
              type="button"
              onClick={onConfirmAll}
              disabled={bulkConfirmPending}
            >
              <CheckCheck size={17} aria-hidden="true" />
              {bulkConfirmProgress ?? `Подтвердить без замечаний ${summary.bulkConfirmableCount}`}
            </button>
          ) : null}

          {canWrite && summary !== null && summary.failedDocumentCount > 0 ? (
            <button
              className="button page-hero__action"
              type="button"
              onClick={onRestartFailed}
              disabled={restartAllPending}
            >
              <RefreshCw size={17} aria-hidden="true" />
              {restartAllPending
                ? "Запускаем…"
                : `Перезапустить разбор ${summary.failedDocumentCount}`}
            </button>
          ) : null}
        </>
      }
    />
  );
}
