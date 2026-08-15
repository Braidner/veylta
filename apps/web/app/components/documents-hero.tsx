"use client";

import type { PatientProfileSummary } from "@veylta/contracts";
import { CheckCheck, FileUp, RefreshCw, Search, X } from "lucide-react";
import type { DocumentsArchiveHero } from "../documents-archive";
import {
  archiveDocumentCountCopy,
  archiveValueCountCopy,
  sourceCountCopy,
} from "../documents-archive";
import { PageHero } from "./page-hero";

interface DocumentsHeroProps {
  readonly familyName: string;
  readonly profileName: string;
  readonly profileId: string;
  readonly profiles: readonly PatientProfileSummary[];
  readonly onProfileChange: (familyId: string, profileId: string) => void;
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
  familyName,
  profileName,
  profileId,
  profiles,
  onProfileChange,
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
      /* The active person stays beside the page title, never only inside navigation. */
      contextLine={
        <>
          <span>{familyName}</span>
          <span aria-hidden="true">/</span>
          <span>{profileName}</span>
        </>
      }
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
          <label className="page-hero__switcher">
            <span className="visually-hidden">Активный профиль</span>
            <select
              aria-label="Активный профиль"
              value={profileId}
              onChange={(event) => {
                const selected = profiles.find((item) => item.id === event.target.value);
                if (selected !== undefined) onProfileChange(selected.familyId, selected.id);
              }}
            >
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>

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
      footer={
        summary === null ? (
          <p className="page-hero__facts page-hero__facts--pending" aria-hidden="true">
            <span className="skeleton skeleton--hero-fact" />
            <span className="skeleton skeleton--hero-fact" />
          </p>
        ) : (
          <>
            <dl className="page-hero__facts">
              <div>
                <dt>В архиве</dt>
                <dd>{sourceCountCopy(summary.sourceCount)}</dd>
              </div>
              <div>
                <dt>Ждут решения</dt>
                <dd>
                  {archiveValueCountCopy(summary.pendingFactCount)}
                  <small>в {archiveDocumentCountCopy(summary.pendingDocumentCount)}</small>
                </dd>
              </div>
              {summary.needsAttentionFactCount > 0 ? (
                <div>
                  <dt>Только по одному</dt>
                  <dd>{archiveValueCountCopy(summary.needsAttentionFactCount)}</dd>
                </div>
              ) : null}
              {summary.failedDocumentCount > 0 ? (
                <div>
                  <dt>Разбор не прошёл</dt>
                  <dd>{archiveDocumentCountCopy(summary.failedDocumentCount)}</dd>
                </div>
              ) : null}
            </dl>
            <small>
              Только вымышленные PDF, PNG и JPEG до 5 МБ. Не загружайте реальные медицинские данные.
            </small>
          </>
        )
      }
    />
  );
}
