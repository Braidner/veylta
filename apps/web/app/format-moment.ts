const canonicalTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const calendarDate = /^\d{4}-\d{2}-\d{2}$/;

/** "17 августа 2026 г. в 00:13", in the reader's own time zone. */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(
    new Date(value),
  );
}

/** "17 авг., 19:45" — the short form a list row can afford, in the reader's own time zone. */
export function formatShortMoment(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/**
 * A laboratory date without a time reaches us as midnight UTC (the extractor's rule for a
 * date-only source) or as a plain calendar date. Such a value stands on a day, not a moment:
 * rendering it in the reader's zone would shift the day westwards.
 */
function dayOnly(value: string): Date | null {
  if (calendarDate.test(value)) return new Date(`${value}T00:00:00.000Z`);
  if (canonicalTimestamp.test(value) && value.endsWith("T00:00:00.000Z")) return new Date(value);
  return null;
}

/**
 * A moment as the source printed it. Showing a clock time for a date-only value would invent
 * precision, so only a real time of day is rendered with hours and minutes.
 */
export function formatSampleMoment(value: string): string {
  const day = dayOnly(value);
  if (day !== null) {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(day);
  }
  if (canonicalTimestamp.test(value)) return formatDate(value);
  return value;
}

/** "14 мая" — the day a value stands on, for a line too tight to carry the year or the time. */
export function formatSampleDay(value: string): string {
  const day = dayOnly(value);
  if (day !== null) {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(day);
  }
  if (!canonicalTimestamp.test(value)) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(
    new Date(value),
  );
}
