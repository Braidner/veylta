import type { DocumentProcessingActivityEvent, ProcessingRejectionReason } from "@veylta/contracts";

export interface ProcessingActivityCopy {
  heading: string;
  detail: string;
}

export function processingActivityCopy(
  event: DocumentProcessingActivityEvent,
): ProcessingActivityCopy {
  switch (event.code) {
    case "queued":
      return {
        heading: "Документ поставлен в очередь",
        detail: "Локальный worker принял задачу на обработку.",
      };
    case "security_check_started":
      return {
        heading: "Проверяем исходник",
        detail: "Сверяем доступ, размер и контрольную сумму сохранённого файла.",
      };
    case "text_extraction_started":
      return {
        heading: "Извлекаем текст",
        detail: "Текстовый слой или изображение подготавливается локально.",
      };
    case "document_classification_started":
      return {
        heading: "Определяем тип документа",
        detail: "Codex выбирает раздел архива и понятное русское название.",
      };
    case "codex_analysis_started":
      return {
        heading: "Codex разбирает данные документа",
        detail: "Модель формирует структурированный JSON со ссылками на фрагменты источника.",
      };
    case "result_validation_started":
      return {
        heading: "Проверяем ответ Codex",
        detail: "Сервер проверяет структуру, типы и точные ссылки на источник.",
      };
    case "result_saved":
      return {
        heading: "Результат сохранён для проверки",
        detail: "Черновые данные записаны отдельно от неизменяемого исходника.",
      };
    case "retry_scheduled":
      return {
        heading: "Назначена повторная попытка",
        detail: "Предыдущая попытка завершилась безопасно; исходник не изменён.",
      };
    case "failed":
      return {
        heading: "Обработка остановлена",
        detail: "Результат не принят. Исходник и предыдущая история сохранены.",
      };
  }
}

const rejectionReasons: Record<ProcessingRejectionReason, string> = {
  schema_shape: "Ответ не совпал с обязательной схемой",
  not_russian: "Ответ пришёл не на русском языке",
  unknown_page: "Codex сослался на страницу, которой нет в документе",
  fragment_not_on_page: "Процитированный фрагмент не найден на указанной странице",
  invalid_key: "Недопустимый код показателя или результата",
  invalid_number: "Число вне допустимого диапазона",
  invalid_timestamp: "Дата или время в неверном формате либо противоречат друг другу",
  inconsistent_fields: "Поля ответа противоречат друг другу",
  unproven_above_range: "Codex пометил результат как выше нормы, но источник этого не подтверждает",
  duplicate_binding: "Один и тот же источник привязан к нескольким результатам",
  incomplete_facts:
    "Codex перечислил измерения в сводке, но не вынес большинство из них на проверку",
  response_too_large: "Ответ превысил допустимый размер",
  provider_unavailable: "Codex не ответил",
  input_invalid: "Veylta отказалась отправлять такой запрос",
};

const failureCodes: Record<string, string> = {
  ATTEMPT_LIMIT: "Исчерпаны попытки",
  AGENT_OUTPUT_INVALID: "Ответ Codex не прошёл проверку",
  AGENT_UNAVAILABLE: "Codex недоступен",
  DOCUMENT_UNAVAILABLE: "Исходник недоступен",
  EXTRACTION_FAILED: "Не удалось извлечь текст",
  INVALID_DOCUMENT: "Содержимое документа не принято",
  VALIDATION_FAILED: "Результат не прошёл проверку",
};

const stages: Record<string, string> = {
  security_check: "проверка исходника",
  text_extraction: "извлечение текста",
  document_classification: "определение типа",
  structured_extraction: "структурированный разбор",
  validation: "проверка результата",
};

/** Falls back to the raw code so an unmapped value stays visible instead of vanishing. */
export function rejectionReasonCopy(reason: ProcessingRejectionReason): string {
  return rejectionReasons[reason] ?? reason;
}

export function failureCodeCopy(code: string): string {
  return failureCodes[code] ?? code;
}

export function stageCopy(stage: string): string {
  return stages[stage] ?? stage;
}
