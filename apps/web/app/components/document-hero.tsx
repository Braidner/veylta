import { Download, RefreshCw, Trash2 } from "lucide-react";

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
    <header className="document-hero" data-testid="document-hero">
      <div className="document-hero__identity">
        <p className="context-line">Документ профиля</p>
        <h1 id="document-title">{title}</h1>
        <p className="document-meta">{metadata}</p>
      </div>

      <fieldset className="document-hero__actions">
        <legend className="visually-hidden">Действия с документом</legend>
        <a className="button document-hero__action" href={downloadHref} download>
          <Download size={17} aria-hidden="true" />
          Скачать
        </a>
        {canRestart ? (
          <button
            className="button document-hero__action"
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
            className="button document-hero__action document-hero__action--danger"
            type="button"
            onClick={onDelete}
          >
            <Trash2 size={17} aria-hidden="true" />
            Удалить
          </button>
        ) : null}
      </fieldset>

      {restartError === null ? null : (
        <p className="form-error document-hero__error" role="alert">
          {restartError}
        </p>
      )}

      <div className="document-hero__summary">
        <p>{summary}</p>
        {resultAvailability === null ? null : (
          <p className="document-hero__result-state" role="status">
            {resultAvailability}
          </p>
        )}
        <small>Фактическое описание источника, не диагноз и не медицинская рекомендация.</small>
      </div>
    </header>
  );
}
