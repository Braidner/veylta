const canonicalTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const calendarDate = /^\d{4}-\d{2}-\d{2}$/;

/** "17 августа 2026 г. в 00:13", in the reader's own time zone. */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(
    new Date(value),
  );
}

/**
 * A moment as the source printed it. A laboratory date without a time reaches us as midnight UTC
 * (the extractor's rule for a date-only source) or as a plain calendar date; showing a clock time
 * for it would invent precision — and shift the day in western time zones. Only a real time of day
 * is rendered with hours and minutes.
 */
export function formatSampleMoment(value: string): string {
  if (
    calendarDate.test(value) ||
    (canonicalTimestamp.test(value) && value.endsWith("T00:00:00.000Z"))
  ) {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(calendarDate.test(value) ? `${value}T00:00:00.000Z` : value),
    );
  }
  if (canonicalTimestamp.test(value)) return formatDate(value);
  return value;
}
