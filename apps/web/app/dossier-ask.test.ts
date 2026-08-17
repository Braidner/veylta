import assert from "node:assert/strict";
import test from "node:test";
import { attentionBySpecialty, buildDossierSeries } from "./dossier";
import { observation } from "./dossier.fixture";
import {
  askConversationTitle,
  askPurpose,
  askQuestion,
  fallbackQuestion,
  parseAsk,
  stashDossierAsk,
  takeDossierAsk,
} from "./dossier-ask";

const series = buildDossierSeries(
  [
    observation({
      id: "1",
      code: "tsh",
      name: "ТТГ",
      value: "9,9",
      at: "2026-08-10T08:00:00.000Z",
    }),
    observation({
      id: "0",
      code: "tsh",
      name: "ТТГ",
      value: "8,1",
      at: "2026-05-10T08:00:00.000Z",
    }),
    observation({
      id: "2",
      code: "hemoglobin",
      name: "Гемоглобин",
      value: "9,8",
      unit: "г/дл",
      low: "12,0",
      high: "16,0",
      text: "12,0–16,0",
    }),
    observation({
      id: "3",
      code: "leukocytes",
      name: "Лейкоциты",
      value: "6,1",
      low: "4",
      high: "9",
    }),
  ],
  "female",
);
const groups = attentionBySpecialty(series);

test("an ask is a closed value: a specialty, the therapist, or the консилиум", () => {
  assert.equal(parseAsk("cardiologist"), "cardiologist");
  assert.equal(parseAsk("consilium"), "consilium");
  assert.equal(parseAsk("astrologer"), null);
  assert.equal(parseAsk(undefined), null);
  assert.equal(askPurpose("cardiologist"), "dossier:cardiologist");
  assert.equal(askPurpose("consilium"), "dossier:consilium");
  assert.equal(askConversationTitle("cardiologist"), "Досье · Кардиолог");
  assert.equal(askConversationTitle("consilium"), "Досье · Консилиум");
  assert.equal(askConversationTitle("therapist"), "Досье · Терапевт");
});

test("a specialist's question names the group's findings as the dossier read them", () => {
  const endocrinology = groups.find((group) => group.specialty === "endocrinologist");
  assert.ok(endocrinology);
  assert.equal(
    askQuestion("endocrinologist", endocrinology.series),
    "Насколько срочно показать эндокринологу эти значения из моего досье: ТТГ 9,9 мМЕ/л — выше референса лаборатории (0,4 - 4,0), с прошлого раза +1,8, второй раз подряд вне референса? Что стоит уточнить до визита?",
  );
  const consilium = askQuestion(
    "consilium",
    groups.flatMap((group) => group.series),
  );
  assert.match(
    consilium,
    /^Что в моём досье требует внимания в первую очередь и насколько срочно\?/,
  );
  assert.match(consilium, /Гемоглобин 9,8 г\/дл — ниже референса лаборатории \(12,0–16,0\)/);
  assert.match(consilium, /ТТГ 9,9 мМЕ\/л/);
  assert.equal(
    fallbackQuestion("cardiologist"),
    "Насколько срочно показать кардиологу значения вне референса из моего досье? Что стоит уточнить до визита?",
  );
});

test("the question travels through session storage once, keyed by profile", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  stashDossierAsk(storage, "p1", { ask: "cardiologist", question: "Насколько срочно…" });
  assert.equal(takeDossierAsk(storage, "p2", "cardiologist"), null, "another profile");
  assert.deepEqual(takeDossierAsk(storage, "p1", "cardiologist"), {
    ask: "cardiologist",
    question: "Насколько срочно…",
  });
  assert.equal(takeDossierAsk(storage, "p1", "cardiologist"), null, "taken once");
  // A handoff meant for another addressee is discarded rather than kept for later.
  stashDossierAsk(storage, "p1", { ask: "cardiologist", question: "Насколько срочно…" });
  assert.equal(takeDossierAsk(storage, "p1", "consilium"), null);
  assert.equal(takeDossierAsk(storage, "p1", "cardiologist"), null);
  storage.setItem("veylta:dossier-ask:p1", "{not json");
  assert.equal(takeDossierAsk(storage, "p1", "cardiologist"), null);
});
