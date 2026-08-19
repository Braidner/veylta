"use client";

import { latestCorrectableDate } from "@veylta/contracts";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../api-client";
import { documentCategoryLabels, effectiveDateCopy, type TimelineNode } from "../document-timeline";
import { documentPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { DocumentDateEditor } from "./document-date-editor";

/** One node of the timeline; it owns the date field it opens, so a failure stays on this document. */
export function DocumentTimelineNode({
  node,
  canWrite,
  onCorrectDate,
}: {
  readonly node: TimelineNode;
  readonly canWrite: boolean;
  readonly onCorrectDate: (documentId: string, value: string | null) => Promise<void>;
}) {
  const handle = useProfileHandle();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = effectiveDateCopy(node.effectiveDate);

  async function save(value: string | null) {
    setPending(true);
    setError(null);
    try {
      await onCorrectDate(node.id, value);
      setEditing(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 422
          ? "Дата не подходит: нужен календарный день не позже завтрашнего."
          : "Не удалось сохранить дату. Проверьте соединение и повторите.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="document-timeline__node" data-testid={`timeline-node-${node.id}`}>
      <div className="document-timeline__date">
        <time dateTime={node.effectiveDate.value}>{date.date}</time>
        {date.marker === null ? null : (
          <span className="document-timeline__marker">{date.marker}</span>
        )}
        {canWrite && !editing ? (
          <button
            className="text-link text-link--button document-timeline__correct"
            type="button"
            onClick={() => setEditing(true)}
          >
            <Pencil size={13} aria-hidden="true" />
            Исправить дату
          </button>
        ) : null}
      </div>
      {editing ? (
        <DocumentDateEditor
          value={node.effectiveDate.value}
          max={latestCorrectableDate(new Date())}
          canClear={node.effectiveDate.source === "person"}
          pending={pending}
          error={error}
          onSave={(value) => void save(value)}
          onClear={() => void save(null)}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <div className="document-timeline__body">
        <p className="document-timeline__kicker">
          {node.category === null ? "Документ" : documentCategoryLabels[node.category]}
        </p>
        <Link className="document-timeline__title" href={documentPath(handle, node.id)}>
          {node.title}
        </Link>
        {node.shortSummary === null ? null : (
          <p className="document-timeline__summary">{node.shortSummary}</p>
        )}
        <p className="document-timeline__filename">{node.filename}</p>
        {node.counts.length > 0 ? (
          <ul className="document-timeline__counts">
            {node.counts.map((count) => (
              <li key={count}>{count}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
