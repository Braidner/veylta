import { ApiError } from "./api-client";

export function assistantSendErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "ACKNOWLEDGEMENT_REQUIRED") {
    return "Сначала подтвердите отправку данных в Codex.";
  }
  if (error instanceof ApiError && error.status === 409) {
    return "В этом диалоге больше нельзя отправлять сообщения — создайте новый.";
  }
  return "Не удалось получить ответ. Проверьте соединение и повторите отправку.";
}

export function assistantConsiliumErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "NOBODY_TO_CONVENE") {
    return "Некого приглашать: среди подтверждённых значений нет профильных показателей.";
  }
  return assistantSendErrorCopy(error);
}

export function assistantCreateErrorCopy(error: unknown): string {
  return error instanceof ApiError && error.status === 409
    ? "Нельзя создать больше 20 диалогов для одного профиля."
    : "Не удалось создать диалог. Проверьте соединение и повторите.";
}
