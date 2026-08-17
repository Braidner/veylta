import type {
  DocumentIntelligenceResultStatus,
  DocumentIntelligenceStructuredResult,
} from "@veylta/contracts";

/** How a structured result reads on the document page: its status and its type, in Russian. */
export function documentResultStatusCopy(status: DocumentIntelligenceResultStatus): string {
  switch (status) {
    case "above_range":
      return "Выше диапазона";
    case "normal":
      return "В пределах источника";
    case "abnormal":
      return "Отмечено источником";
    case "detected":
      return "Обнаружено";
    case "not_detected":
      return "Не обнаружено";
    case "completed":
      return "Выполнено";
    case "informational":
      return "Информация";
    case "unknown":
      return "Без оценки";
  }
}

export function documentResultStatusPriority(
  status: DocumentIntelligenceResultStatus | null,
): number {
  return status === "above_range" ? 0 : 1;
}

export function prioritizeDocumentResults(
  results: readonly DocumentIntelligenceStructuredResult[],
): readonly DocumentIntelligenceStructuredResult[] {
  return [...results].sort(
    (left, right) =>
      documentResultStatusPriority(left.status) - documentResultStatusPriority(right.status),
  );
}

export function documentResultTypeCopy(type: string): string {
  switch (type) {
    case "measurement":
      return "Измерение";
    case "genetic_variant":
      return "Генетический вариант";
    case "finding":
      return "Наблюдение";
    case "procedure":
      return "Процедура";
    case "medication":
      return "Препарат";
    case "diagnosis":
      return "Формулировка источника";
    case "referral":
      return "Направление";
    case "follow_up":
      return "Контроль";
    default:
      return "Результат";
  }
}
