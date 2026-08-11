import { SystemStatus } from "./components/system-status";

const foundation = [
  "Изолированный API и отдельная фоновая обработка",
  "PostgreSQL с явными обратимыми миграциями",
  "Версионированные контракты хранения и извлечения",
  "Автоматическая проверка лицензий в CI",
];

export default function Home() {
  return (
    <main>
      <header className="workspace-bar">
        <a className="wordmark" href="/" aria-label="Family Health — главная">
          <span aria-hidden="true">FH</span>
          Family Health
        </a>
        <span className="environment">Только синтетика</span>
      </header>

      <section className="foundation-shell" aria-labelledby="foundation-title">
        <div className="foundation-intro">
          <p className="context-line">Надёжная семейная история здоровья</p>
          <h1 id="foundation-title">Источник остаётся рядом с каждым значением.</h1>
          <p className="lede">
            Мы начинаем с узкого проверяемого пути: семейный профиль, синтетический документ, ручная
            проверка и подтверждённый показатель со ссылкой на источник.
          </p>
          <SystemStatus />
        </div>

        <section className="foundation-details" aria-labelledby="foundation-details-title">
          <h2 id="foundation-details-title">Инженерная основа</h2>
          <ul>
            {foundation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            Реальные медицинские файлы пока не принимаются. Следующий этап добавляет изолированные
            семейные профили с серверной авторизацией.
          </p>
        </section>
      </section>
    </main>
  );
}
