const kilobytes = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** «512 Б», «12,3 КБ», «2,40 МБ» — one reading of a byte count for every surface. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${kilobytes.format(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(2).replace(".", ",")} МБ`;
}
