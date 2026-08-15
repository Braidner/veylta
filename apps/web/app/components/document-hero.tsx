import { Download, RefreshCw, Trash2 } from "lucide-react";
import { PageHero } from "./page-hero";

interface DocumentHeroProps {
  readonly title: string;
  readonly metadata: string;
  readonly summary: string;
  readonly resultAvailability: string | null;
  readonly downloadHref: string;
  readonly canRestart: boolean;
  readonly restartPending: boolean;
  readonly restartError: string | null;
  readonly canDelete: boolean;
  readonly onRestart: () => void;
  readonly onDelete: () => void;
}

export function DocumentHero({
  title,
  metadata,
  summary,
  resultAvailability,
  downloadHref,
  canRestart,
  restartPending,
  restartError,
  canDelete,
  onRestart,
  onDelete,
}: DocumentHeroProps) {
  return (
    <PageHero
      testId="document-hero"
      contextLine="Документ профиля"
      titleId="document-title"
      title={title}
      meta={metadata}
      actionsLabel="Действия с документом"
      error={restartError}
      actions={
        <>
          <a className="button page-hero__action" href={downloadHref} download>
            <Download size={17} aria-hidden="true" />
            Скачать
          </a>
          {canRestart ? (
            <button
              className="button page-hero__action"
              type="button"
              onClick={onRestart}
              disabled={restartPending}
            >
              <RefreshCw size={17} aria-hidden="true" />
              {restartPending ? "Запускаем…" : "Перезапустить разбор"}
            </button>
          ) : null}
          {canDelete ? (
            <button
              className="button page-hero__action page-hero__action--danger"
              type="button"
              onClick={onDelete}
            >
              <Trash2 size={17} aria-hidden="true" />
              Удалить
            </button>
          ) : null}
        </>
      }
      footer={
        <>
          <p>{summary}</p>
          {resultAvailability === null ? null : (
            <p className="page-hero__result-state" role="status">
              {resultAvailability}
            </p>
          )}
          <small>Фактическое описание источника, не диагноз и не медицинская рекомендация.</small>
        </>
      }
    />
  );
}
