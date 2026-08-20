"use client";

import { type TimelineGroup, type TimelineNode, timelineGroups } from "../document-timeline";
import { DocumentTimelineNode } from "./document-timeline-node";

/**
 * «Лента»: a vertical timeline, newest first, grouped by month with a year marker. A node shows
 * the date (and its source when it is not the document's own), category and title, filename,
 * counts, and the way into the document. The pencil opens the date field.
 */
export function DocumentTimeline({
  nodes,
  grouped,
  canWrite,
  nextBefore,
  loadingMore,
  onLoadMore,
  onCorrectDate,
  heading,
}: {
  readonly nodes: readonly TimelineNode[];
  /** Search results come flat; the record comes grouped by month. */
  readonly grouped: boolean;
  readonly canWrite: boolean;
  readonly nextBefore: string | null;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly onCorrectDate: (documentId: string, value: string | null) => Promise<void>;
  /** Search hits say what they are; the record itself needs no visible heading above the months. */
  readonly heading?: { readonly title: string; readonly note: string } | undefined;
}) {
  const groups: readonly TimelineGroup[] = grouped
    ? timelineGroups(nodes)
    : [{ key: "search", label: "", yearMarker: null, nodes }];
  // The scroll focus is a reading cursor for a LONG record; a lente of a few documents barely
  // scrolls, and a lone node would sit dimmed forever, so the effect arms from four nodes up.
  const scrollFocus = nodes.length >= 4 ? " document-timeline--scroll-focus" : "";
  return (
    <section
      className={`document-timeline${scrollFocus}`}
      aria-labelledby="document-timeline-title"
    >
      {heading === undefined ? (
        <h3 id="document-timeline-title" className="visually-hidden">
          Лента документов
        </h3>
      ) : (
        <header className="document-timeline__heading">
          <h3 id="document-timeline-title">{heading.title}</h3>
          <p>{heading.note}</p>
        </header>
      )}
      {nodes.length === 0 ? (
        <p className="document-timeline__empty" role="status">
          В ленте пока ничего нет: документ появляется здесь, когда проверка завершена.
        </p>
      ) : (
        <ol className="document-timeline__months">
          {groups.map((group) => (
            <li key={group.key} className="document-timeline__month">
              {group.yearMarker === null ? null : (
                <p className="document-timeline__year">{group.yearMarker}</p>
              )}
              {group.label === "" ? null : (
                <h4 className="document-timeline__month-title">{group.label}</h4>
              )}
              <ol className="document-timeline__nodes">
                {group.nodes.map((node) => (
                  <DocumentTimelineNode
                    key={node.id}
                    node={node}
                    canWrite={canWrite}
                    onCorrectDate={onCorrectDate}
                  />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {nextBefore === null ? null : (
        <button
          className="button button--secondary document-timeline__more"
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Загружаем…" : "Показать раньше"}
        </button>
      )}
    </section>
  );
}
