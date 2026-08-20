import assert from "node:assert/strict";
import test from "node:test";
import type { CarePlanItem } from "@veylta/contracts";
import { ApiError } from "./api-client";
import { carePlanErrorCopy, carePlanStateCopy } from "./care-plan-copy";

function item(overrides: Partial<CarePlanItem> = {}): CarePlanItem {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    category: "laboratory",
    title: "Повторить ТТГ",
    note: null,
    scheduledFor: null,
    state: "accepted",
    origin: "user",
    revision: 1,
    provenance: null,
    checkins: [],
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

test("every state of an item reads as where it stands, and a day is printed when it has one", () => {
  assert.equal(carePlanStateCopy(item({ state: "proposed" })), "Предложение · ждёт решения");
  assert.equal(carePlanStateCopy(item()), "Принято без срока");
  assert.equal(
    carePlanStateCopy(item({ scheduledFor: "2026-09-15" })),
    "Запланировано · 2026-09-15",
  );
  assert.equal(carePlanStateCopy(item({ state: "completed" })), "Выполнено");
  assert.equal(carePlanStateCopy(item({ state: "dismissed" })), "Отклонено");
});

test("a failed write says what to do next and never claims the stored plan changed", () => {
  assert.equal(
    carePlanErrorCopy(new ApiError(404, null)),
    "План этого профиля недоступен. Вернитесь к доступной карточке.",
  );
  assert.equal(
    carePlanErrorCopy(new ApiError(409, null)),
    "План или сводка уже изменились. Обновите страницу и повторите действие.",
  );
  assert.match(carePlanErrorCopy(new ApiError(503, null)), /^Codex не подготовил черновики\./);
  assert.equal(
    carePlanErrorCopy(new ApiError(422, null)),
    "Проверьте название, примечание и дату действия.",
  );
  assert.equal(
    carePlanErrorCopy(new Error("offline")),
    "Не удалось обновить домашний план. Сохранённые пункты не изменены.",
  );
});
