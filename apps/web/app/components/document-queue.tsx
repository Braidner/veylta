"use client";

import Link from "next/link";
import { isProcessingActive } from "../document-processing-activity";
import { type QueueRow, queueAction, queueStateCopy } from "../document-queue";
import { documentPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { pluralForm } from "../russian-plural";
import type { ArchiveActionState } from "../use-archive-actions";

/**
 * «Очередь»: compact rows for what still needs the machine or the person. One action per row —
 * «Проверить N значений» is the way into the review (a link), «Повторить» retries a failure;
 * a running analysis shows its stage and a spinner. Bulk confirm stays in the hero.
 */
export function DocumentQueue({
  rows,
  canWrite,
  action,
  onRestart,
}: {
  readonly rows: readonly QueueRow[];
  readonly canWrite: boolean;
  readonly action: ArchiveActionState;
  readonly onRestart: (row: QueueRow) => void;
}) {
  const handle = useProfileHandle();
  return (
    <section className="document-queue" aria-labelledby="document-queue-title">
      <header className="document-queue__heading">
        <h3 id="document-queue-title">Очередь</h3>
        <p>Сначала — то, что ждёт решения; ниже — что ещё разбирается или не прошло.</p>
      </header>
      {rows.length === 0 ? (
        <p className="document-queue__empty" role="status">
          Очередь пуста
        </p>
      ) : (
        <ol className="document-queue__rows">
          {rows.map((row) => {
            const next = queueAction(row);
            const busy =
              action.kind === "restarting" &&
              (action.documentId === null || action.documentId === row.document.id);
            return (
              <li
                key={row.document.id}
                className={`document-queue__row document-queue__row--${row.document.processing.state}`}
              >
                <div className="document-queue__identity">
                  <Link
                    className="document-queue__name"
                    href={documentPath(handle, row.document.id)}
                  >
                    {row.document.intelligence?.title ?? row.document.originalFilename}
                  </Link>
                  <span className="document-queue__state">
                    {queueStateCopy(row.document.processing)}
                  </span>
                </div>
                {next.kind === "review" ? (
                  <Link
                    className="button button--secondary"
                    href={documentPath(handle, row.document.id)}
                  >
                    {`Проверить ${next.count} ${pluralForm(next.count, ["значение", "значения", "значений"])}`}
                  </Link>
                ) : null}
                {canWrite && next.kind === "retry" ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => onRestart(row)}
                  >
                    Повторить
                  </button>
                ) : null}
                {next.kind === "none" && isProcessingActive(row.document.processing) ? (
                  <span className="document-queue__progress" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
