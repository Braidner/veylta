"use client";

import type { ObservationHistoryItem } from "@veylta/contracts";
import { formatDate } from "../format-moment";
import { knownObservationDates, observationSourceHref, timelineDate } from "../observation-dates";
import { referenceRangeCopy } from "../reference-range-copy";

export function ObservationHistoryRow({ item }: { item: ObservationHistoryItem }) {
  const date = timelineDate(item);
  const knownDates = knownObservationDates(item);
  const normalizedValue =
    item.normalized.value === null
      ? null
      : `${item.normalized.value}${item.normalized.unit === null ? "" : ` ${item.normalized.unit}`}`;
  const confidence = new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(item.extractionConfidence);

  return (
    <tr>
      <th scope="row">
        <span className="observation-history__name">{item.source.name}</span>
        {item.canonicalCode !== null ? (
          <span className="observation-history__code">{item.canonicalCode}</span>
        ) : null}
      </th>
      <td>
        <strong className="observation-history__value">
          {item.source.value} {item.source.unit}
        </strong>
        {normalizedValue !== null ? (
          <span className="observation-history__normalized">
            Нормализовано: {normalizedValue}
            {item.normalized.conversionVersion === null
              ? ""
              : ` · ${item.normalized.conversionVersion}`}
          </span>
        ) : null}
      </td>
      <td>
        <span className="observation-history__date-label">{date.label}</span>
        <time dateTime={date.value}>{formatDate(date.value)}</time>
      </td>
      <td>
        <details className="observation-history__provenance">
          <summary>Документ · страница {item.sourceDocument.pageNumber}</summary>
          <div className="observation-history__provenance-content">
            <dl>
              <div>
                <dt>Подтверждено</dt>
                <dd>
                  <time dateTime={item.confirmed.at}>{formatDate(item.confirmed.at)}</time>
                  {` · ${item.confirmed.by.displayName}`}
                </dd>
              </div>
              <div>
                <dt>Уверенность извлечения</dt>
                <dd>{confidence}</dd>
              </div>
              <div>
                <dt>Нормализованное значение</dt>
                <dd>{normalizedValue ?? "Не рассчитано"}</dd>
              </div>
              {knownDates.map((knownDate) => (
                <div key={knownDate.label}>
                  <dt>{knownDate.label}</dt>
                  <dd>
                    <time dateTime={knownDate.value}>{formatDate(knownDate.value)}</time>
                  </dd>
                </div>
              ))}
              {item.specimenType !== null ? (
                <div>
                  <dt>Материал</dt>
                  <dd>{item.specimenType}</dd>
                </div>
              ) : null}
              {item.laboratory !== null ? (
                <div>
                  <dt>Лаборатория</dt>
                  <dd>{item.laboratory}</dd>
                </div>
              ) : null}
              {item.referenceRange !== null ? (
                <>
                  <div>
                    <dt>Диапазон в документе</dt>
                    <dd>{referenceRangeCopy(item.referenceRange)}</dd>
                  </div>
                  {item.referenceRange.laboratoryOutOfRange !== null ? (
                    <div>
                      <dt>Отметка лаборатории</dt>
                      <dd>
                        {item.referenceRange.laboratoryOutOfRange
                          ? "Отмечено в исходном документе"
                          : "Не отмечено в исходном документе"}
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
            </dl>
            <p className="observation-history__fragment-label">Фрагмент из исходника</p>
            <pre className="observation-history__fragment">
              <code>{item.sourceDocument.fragment}</code>
            </pre>
            <a
              className="observation-history__source-link"
              href={observationSourceHref(item.sourceDocument.contentPath)}
              download
            >
              Открыть исходник
            </a>
          </div>
        </details>
      </td>
    </tr>
  );
}
