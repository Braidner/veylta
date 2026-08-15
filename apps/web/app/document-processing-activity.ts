import type { DocumentProcessingActivityEvent } from "@veylta/contracts";

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
