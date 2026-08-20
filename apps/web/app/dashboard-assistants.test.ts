import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewAssistant } from "@veylta/contracts";
import { assistantStateLine, firstSentence, relativeDayCopy } from "./dashboard-assistants";

const now = new Date(2026, 7, 20, 11, 0, 0);
const room = (overrides: Partial<ProfileOverviewAssistant> = {}): ProfileOverviewAssistant => ({
  assistantId: "physician",
  answeredAt: new Date(2026, 7, 20, 9, 0, 0).toISOString(),
  urgency: "soon",
  refused: false,
  ...overrides,
});

test("how long ago the room answered is whole days, in the reader's own zone", () => {
  assert.equal(relativeDayCopy(new Date(2026, 7, 20, 0, 5, 0).toISOString(), now), "сегодня");
  assert.equal(relativeDayCopy(new Date(2026, 7, 19, 23, 55, 0).toISOString(), now), "вчера");
  assert.equal(relativeDayCopy(new Date(2026, 7, 18, 9, 0, 0).toISOString(), now), "2 дня назад");
  assert.equal(relativeDayCopy(new Date(2026, 7, 15, 9, 0, 0).toISOString(), now), "5 дней назад");
  assert.equal(relativeDayCopy(new Date(2026, 6, 11, 9, 0, 0).toISOString(), now), "40 дней назад");
});

test("an answered room says when it answered and the tier's own fixed copy", () => {
  assert.equal(
    assistantStateLine([room()], "physician", "Что-то о комнате.", now),
    "Последний ответ сегодня · Запишитесь к врачу в ближайшие недели",
  );
  assert.equal(
    assistantStateLine([room({ urgency: "none" })], "physician", "Что-то о комнате.", now),
    "Последний ответ сегодня · Срочных действий нет",
  );
});

test("a refused turn is stated as a fact, never with its reason", () => {
  const line = assistantStateLine(
    [room({ refused: true, urgency: null })],
    "physician",
    "Что-то о комнате.",
    now,
  );

  assert.equal(line, "Последний ответ не прошёл проверку");
});

test("a room that never answered keeps one sentence of what it is for", () => {
  const rooms = [room({ assistantId: "nutritionist" })];
  const line = assistantStateLine(
    rooms,
    "trainer",
    "Пока нечего оценивать: программа строится на подтверждённых значениях. Второе предложение.",
    now,
  );

  assert.equal(line, "Пока нечего оценивать: программа строится на подтверждённых значениях.");
  assert.equal(assistantStateLine([], "physician", "Одно предложение.", now), "Одно предложение.");
});

test("the first sentence survives copy that has none to cut", () => {
  assert.equal(firstSentence("Одно. Два."), "Одно.");
  assert.equal(firstSentence("Без точки"), "Без точки");
  assert.equal(firstSentence("  Пробелы по краям. Хвост  "), "Пробелы по краям.");
});
