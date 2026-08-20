"use client";

import type { DocumentDetail } from "@veylta/contracts";
import { Bot, FileText, Layers, ShieldCheck } from "lucide-react";
import { pageReadingNotes, pageReadingSummary } from "../document-pages";
import { documentKindLabel } from "../document-source";
import { documentCategoryLabels } from "../document-timeline";
import { formatBytes } from "../format-bytes";
import { formatDate } from "../format-moment";

/** «Страницы»: what read each page of the source, and what a picture on it never told us. */
function DocumentPagesCard({ document }: { document: DocumentDetail }): React.JSX.Element {
  const summary = pageReadingSummary(document.pages);
  const notes = pageReadingNotes(document.pages);
  return (
    <section className="document-rail-card" data-testid="document-pages-card">
      <div className="document-rail-card__title">
        <Layers size={18} aria-hidden="true" />
        <h3>Страницы</h3>
      </div>
      {summary === null ? (
        <p className="document-rail-card__empty">Страницы появятся после разбора документа.</p>
      ) : (
        <p className="document-rail-card__empty">{summary}</p>
      )}
      {notes.length === 0 ? null : (
        <ul className="document-pages-notes">
          {notes.map((note) => (
            <li key={note.pageNumber} data-page-reading={note.kind}>
              <p className="document-pages-notes__head">
                Страница {note.pageNumber} · {note.label}
              </p>
              <p>{note.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The document page's right column: what the source is, how it was read, and what it says. */
export function DocumentSourceRail({ document }: { document: DocumentDetail }): React.JSX.Element {
  const { intelligence } = document;
  return (
    <aside className="document-dashboard-grid__rail" aria-label="Сведения об источнике">
      <section className="document-rail-card">
        <div className="document-rail-card__title">
          <FileText size={18} aria-hidden="true" />
          <h3>Исходник</h3>
        </div>
        <dl>
          <div>
            <dt>Файл</dt>
            <dd>{document.originalFilename}</dd>
          </div>
          <div>
            <dt>Формат</dt>
            <dd>{documentKindLabel(document.contentType)}</dd>
          </div>
          <div>
            <dt>Размер</dt>
            <dd>{formatBytes(document.byteSize)}</dd>
          </div>
          <div>
            <dt>Загружен</dt>
            <dd>{formatDate(document.uploadedAt)}</dd>
          </div>
        </dl>
      </section>

      <DocumentPagesCard document={document} />

      <section className="document-rail-card">
        <div className="document-rail-card__title">
          <Bot size={18} aria-hidden="true" />
          <h3>Классификация</h3>
        </div>
        {intelligence === null ? (
          <p className="document-rail-card__empty">Codex ещё распределяет документ.</p>
        ) : (
          <dl>
            <div>
              <dt>Раздел</dt>
              <dd>{documentCategoryLabels[intelligence.category]}</dd>
            </div>
            <div>
              <dt>Дата документа</dt>
              <dd>{intelligence.documentDate ?? "Не указана"}</dd>
            </div>
            <div>
              <dt>Модель</dt>
              <dd>{intelligence.modelId}</dd>
            </div>
            <div>
              <dt>Уверенность</dt>
              <dd>{Math.round(intelligence.confidence * 100)}%</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="document-rail-card document-rail-card--integrity">
        <div className="document-rail-card__title">
          <ShieldCheck size={18} aria-hidden="true" />
          <h3>Целостность</h3>
        </div>
        <p>Оригинальные байты сверяются перед каждой обработкой.</p>
        <details>
          <summary>Показать SHA-256</summary>
          <code>{document.sha256}</code>
        </details>
      </section>
    </aside>
  );
}
