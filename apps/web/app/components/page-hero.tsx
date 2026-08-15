import type { ReactNode } from "react";

interface PageHeroProps {
  /** Kicker above the title. Both surfaces use it to keep the active person explicit. */
  readonly contextLine: ReactNode;
  readonly titleId: string;
  readonly title: string;
  readonly meta?: ReactNode;
  /** Accessible name for the action rail; each surface names its own verbs. */
  readonly actionsLabel: string;
  readonly actions: ReactNode;
  /** Optional surface-scoped search, rendered inside the identity column. */
  readonly search?: ReactNode;
  readonly error?: string | null;
  readonly footer?: ReactNode;
  readonly testId?: string;
}

/**
 * The one hero. A document and the documents archive are the same kind of surface — an
 * identity, a rail of verbs, and a factual footer — so they share this shell rather than
 * drifting into two banners that almost match.
 */
export function PageHero({
  contextLine,
  titleId,
  title,
  meta,
  actionsLabel,
  actions,
  search,
  error = null,
  footer,
  testId,
}: PageHeroProps) {
  return (
    <header className="page-hero" data-testid={testId}>
      <div className="page-hero__identity">
        <p className="context-line">{contextLine}</p>
        <h1 id={titleId}>{title}</h1>
        {meta === undefined ? null : <p className="page-hero__meta">{meta}</p>}
        {search === undefined ? null : <div className="page-hero__search-slot">{search}</div>}
      </div>

      <fieldset className="page-hero__actions">
        <legend className="visually-hidden">{actionsLabel}</legend>
        {actions}
      </fieldset>

      {error === null || error === undefined ? null : (
        <p className="form-error page-hero__error" role="alert">
          {error}
        </p>
      )}

      {footer === undefined ? null : <div className="page-hero__footer">{footer}</div>}
    </header>
  );
}
