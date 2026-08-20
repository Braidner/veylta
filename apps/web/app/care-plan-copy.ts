import type { CarePlanItem } from "@veylta/contracts";
import { ApiError } from "./api-client";

/**
 * What went wrong while writing to the plan, in the person's own words, and always with the promise
 * that what they already stored is untouched. The status is authoritative — never a model sentence.
 */
export function carePlanErrorCopy(error: unknown): string {
  if (error instanceof ApiError && [401, 404].includes(error.status)) {
    return "План этого профиля недоступен. Вернитесь к доступной карточке.";
  }
  if (error instanceof ApiError && error.status === 409) {
    return "План или сводка уже изменились. Обновите страницу и повторите действие.";
  }
  if (error instanceof ApiError && error.status === 503) {
    return "Codex не подготовил черновики. Проверьте в настройках вход через ChatGPT и повторите позже.";
  }
  if (error instanceof ApiError && [400, 422].includes(error.status)) {
    return "Проверьте название, примечание и дату действия.";
  }
  return "Не удалось обновить домашний план. Сохранённые пункты не изменены.";
}

/** Where one item stands: a draft still waits for the person, an accepted one may carry a day. */
export function carePlanStateCopy(item: CarePlanItem): string {
  switch (item.state) {
    case "proposed":
      return "Предложение · ждёт решения";
    case "accepted":
      return item.scheduledFor === null
        ? "Принято без срока"
        : `Запланировано · ${item.scheduledFor}`;
    case "completed":
      return "Выполнено";
    case "dismissed":
      return "Отклонено";
  }
}
