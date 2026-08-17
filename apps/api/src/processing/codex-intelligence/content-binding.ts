import { unitlessMark } from "./readings.js";

export interface ContentHints {
  readonly unit: string | null;
  readonly range: string | null;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

interface Line {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const compact = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");

function lines(page: string): Line[] {
  const result: Line[] = [];
  let start = 0;
  for (const [index, text] of page.split("\n").entries()) {
    result.push({ index, start, end: start + text.length, text });
    start += text.length + 1;
  }
  return result;
}

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The value as a number of its own on the line — not the tail or head of a longer number. */
function carriesValue(line: string, value: string): boolean {
  return new RegExp(`(?<![\\d.,])${escaped(value)}(?![\\d.,])`, "u").test(line);
}

/** A value cell printed on a line of its own: nothing else numeric shares that line. */
function bareValueLine(line: string, value: string): boolean {
  return !/\d/.test(line.replace(new RegExp(escaped(value), "u"), ""));
}

/**
 * Where a reading stands on the page when the model's quote of its row does not: the one
 * place where the value is printed as a number of its own and its unit and reference range
 * are printed with it — on the same line, or within two lines when the value stands in a cell
 * of its own (prose that happens to mention the number never reaches across lines). A bare
 * number with no unit or range binds nowhere. What comes back is the page's own block of
 * lines, so the stored fragment is still verbatim page text. Two such places, or none, and
 * the reading stays unbound.
 */
export function contentSpan(page: string, value: string, hints: ContentHints): Span | null {
  const unit = hints.unit === null || hints.unit === unitlessMark ? null : compact(hints.unit);
  const range = hints.range === null ? null : compact(hints.range);
  const needles = [unit, range].filter((needle): needle is string => needle !== null);
  if (needles.length === 0 || value.trim().length === 0) return null;
  const all = lines(page);
  const candidates: Span[] = [];
  for (const line of all) {
    if (!carriesValue(line.text, value)) continue;
    let bound: Span | null = null;
    for (const reach of [0, 1, 2]) {
      if (reach > 0 && !bareValueLine(line.text, value)) break;
      for (const direction of reach === 0 ? [0] : [1, -1]) {
        const other = all[line.index + reach * direction];
        if (other === undefined) continue;
        const from = Math.min(line.start, other.start);
        const to = Math.max(line.end, other.end);
        const block = compact(page.slice(from, to));
        if (needles.every((needle) => block.includes(needle))) {
          bound = { start: from, end: to };
          break;
        }
      }
      if (bound !== null) break;
    }
    if (bound !== null && !candidates.some((c) => c.start === bound.start && c.end === bound.end)) {
      candidates.push(bound);
    }
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
