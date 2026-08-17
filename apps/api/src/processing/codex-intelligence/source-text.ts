import type { ParsedDocumentPage } from "../synthetic-lab-parser.js";
import { limits } from "./constants.js";
import { invalidOutput } from "./errors.js";
import { exactKeys, object } from "./field-parsers.js";

export interface SourceProvenance {
  readonly pageNumber: number;
  readonly fragment: string;
  /**
   * The fragment with the few printed lines around it — up to four above, two below — where
   * a laboratory prints a row's name as a heading over its value line. For binding a name,
   * never stored.
   */
  readonly context: string;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

function boundedSourceFragment(value: unknown): string {
  const normalized = typeof value === "string" ? value.replaceAll("\r\n", "\n") : value;
  if (
    typeof normalized !== "string" ||
    normalized.length < 12 ||
    normalized.length > limits.fragmentCharacters ||
    normalized !== normalized.trim() ||
    [...normalized].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code < 32 && code !== 10) || code === 127;
    })
  ) {
    invalidOutput("fragment_not_on_page");
  }
  return normalized;
}

/** The fragment's single exact occurrence on the page; null when it is absent or repeated. */
function uniqueSpan(page: string, fragment: string): Span | null {
  const first = page.indexOf(fragment);
  if (first < 0 || page.indexOf(fragment, first + fragment.length) >= 0) return null;
  return { start: first, end: first + fragment.length };
}

/**
 * A multi-line fragment whose lines are all printed but not adjacent — a table header stitched
 * to a row, say — still names the source line: the one line among them that carries the value
 * and occurs exactly once on the page. Anything less specific is refused.
 */
function valueLineSpan(page: string, fragment: string, value: string | null): Span | null {
  if (value === null || !fragment.includes("\n")) return null;
  const spans = fragment
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(value))
    .map((line) => uniqueSpan(page, line))
    .filter((span) => span !== null);
  return spans.length === 1 ? (spans[0] ?? null) : null;
}

function surroundingLines(
  page: string,
  start: number,
  end: number,
  above: number,
  below: number,
): string {
  let from = start;
  for (let step = 0; step < above && from > 0; step += 1) {
    from = page.lastIndexOf("\n", from - 2) + 1;
  }
  let to = end;
  for (let step = 0; step < below && to < page.length; step += 1) {
    const next = page.indexOf("\n", to + 1);
    to = next < 0 ? page.length : next;
  }
  return page.slice(from, to);
}

/**
 * The page set every fragment is checked against: the text layer of the document, or the
 * model's own transcription of attached page images. Provenance is always the page's own text —
 * a requested fragment is located on the page and widened to the complete printed line(s), so
 * what is stored can be found verbatim in the source.
 */
export class SourceText {
  private readonly pages: ReadonlyMap<number, ParsedDocumentPage>;

  constructor(pages: readonly ParsedDocumentPage[]) {
    this.pages = new Map(pages.map((page) => [page.pageNumber, page]));
  }

  page(pageNumber: number): ParsedDocumentPage {
    const page = this.pages.get(pageNumber);
    if (page === undefined) invalidOutput("unknown_page");
    return page;
  }

  /**
   * Reads a `source` object of the answer and binds it to the page. `value` is the reading the
   * fragment must carry, so a stitched multi-line fragment can still resolve to its value line.
   */
  provenance(source: unknown, value: string | null): SourceProvenance {
    const proposed = object(source);
    exactKeys(proposed, ["pageNumber", "fragment"]);
    if (!Number.isSafeInteger(proposed.pageNumber)) invalidOutput("schema_shape");
    const pageNumber = proposed.pageNumber as number;
    const requested = boundedSourceFragment(proposed.fragment);
    const pageText = this.page(pageNumber).text.replaceAll("\r\n", "\n");
    const span = uniqueSpan(pageText, requested) ?? valueLineSpan(pageText, requested, value);
    if (span === null) invalidOutput("fragment_not_on_page");
    const lineStart = pageText.lastIndexOf("\n", span.start - 1) + 1;
    const followingLineBreak = pageText.indexOf("\n", span.end);
    const lineEnd = followingLineBreak < 0 ? pageText.length : followingLineBreak;
    return {
      pageNumber,
      fragment: boundedSourceFragment(pageText.slice(lineStart, lineEnd).trim()),
      context: surroundingLines(pageText, lineStart, lineEnd, 4, 2),
    };
  }
}
