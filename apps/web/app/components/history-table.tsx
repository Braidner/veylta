"use client";

import type { ObservationHistoryItem } from "@veylta/contracts";
import type { DossierSeries } from "../dossier";
import { historyValueCap } from "../use-history-data";
import { ObservationHistoryRow } from "./observation-history-row";

interface HistoryTableProps {
  /** The indicator the table is about; `null` while the record holds nothing confirmed. */
  readonly series: DossierSeries | null;
  /** The selected indicator's confirmed values, newest first, as the API returned them. */
  readonly items: readonly ObservationHistoryItem[];
  readonly truncated: boolean;
}

/**
 * The chart's numbers in full: every confirmed value of the selected indicator with the fragment
 * it came from and a link to its source. The section keeps the page's anchor and its name, so a
 * link into `#observation-history` still lands on the record itself.
 */
export function HistoryTable({ series, items, truncated }: HistoryTableProps) {
  return (
    <section
      id="observation-history"
      className="observation-history"
      aria-labelledby="observation-history-title"
    >
      <div className="observation-history__heading">
        <p className="context-line">Подтверждённые наблюдения</p>
        <h2 id="observation-history-title">История подтверждённых значений</h2>
        <p>
          Здесь показаны только значения, которые пользователь явно подтвердил или исправил.
          Исходный фрагмент и ссылка на исходник остаются рядом с каждым значением. Медицинские
          выводы не формируются.
        </p>
      </div>

      {series === null || items.length === 0 ? (
        <div className="observation-history__empty" role="status">
          <p>
            Пока нет подтверждённых значений. Подтвердите значения на странице документа — здесь
            появится динамика.
          </p>
        </div>
      ) : (
        <>
          <div className="observation-history__table-wrap">
            <table>
              <caption>
                {series.name} · {series.unit} — подтверждённые значения, новые сверху
              </caption>
              <thead>
                <tr>
                  <th scope="col">Показатель</th>
                  <th scope="col">Значение как подтверждено</th>
                  <th scope="col">Дата</th>
                  <th scope="col">Источник</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ObservationHistoryRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
          {truncated ? (
            <p className="observation-history__note">
              Показаны последние {historyValueCap} подтверждённых значений.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
