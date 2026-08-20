import {
  DOCUMENT_PAGE_VISION_METHOD,
  type DocumentPageReading,
  type DocumentPageUnreadReason,
} from "@veylta/contracts";
import { countCopy } from "./russian-plural";

/** One page that has something to say about how the analysis read it. */
export interface PageReadingNote {
  readonly pageNumber: number;
  /** Provenance, not a grade: whether the picture on the page reached the analysis at all. */
  readonly kind: "read" | "unread";
  readonly label: string;
  readonly detail: string;
}

const pageForms: readonly [string, string, string] = ["страница", "страницы", "страниц"];

/** Fixed copy per closed reason; the server never sends a sentence, only one of these codes. */
const unreadDetail: Record<DocumentPageUnreadReason, string> = {
  image_page_limit: "В один разбор поместились не все страницы с рисунками.",
  vision_unavailable: "Разбор изображения не завершился.",
};

// The page's own text layer was read as usual; only what the picture holds is missing.
const unreadConsequence = "Данных с рисунка в документе нет.";

/**
 * The pages worth naming: one whose picture the vision pass transcribed, and one whose picture
 * was never read. A page taken from the PDF's own text layer is the ordinary case and says
 * nothing. An unread reason outranks the method, because a page may hold a transcription of an
 * earlier run and still have a picture this analysis could not reach.
 */
export function pageReadingNotes(
  pages: readonly DocumentPageReading[],
): readonly PageReadingNote[] {
  const notes: PageReadingNote[] = [];
  for (const page of pages) {
    if (page.unreadReason !== null) {
      notes.push({
        pageNumber: page.pageNumber,
        kind: "unread",
        label: "Рисунок не прочитан",
        detail: `${unreadDetail[page.unreadReason]} ${unreadConsequence}`,
      });
    } else if (page.extractionMethod === DOCUMENT_PAGE_VISION_METHOD) {
      notes.push({
        pageNumber: page.pageNumber,
        kind: "read",
        label: "Рисунок прочитан",
        detail:
          "Страница ушла в Codex картинкой, и он расшифровал её в текст. " +
          "Факты с неё ссылаются на эту расшифровку.",
      });
    }
  }
  return notes;
}

/** «2 страницы · текстовый слой и разбор изображения»; null while no analysis stored a page. */
export function pageReadingSummary(pages: readonly DocumentPageReading[]): string | null {
  if (pages.length === 0) return null;
  const vision = pages.filter((page) => page.extractionMethod === DOCUMENT_PAGE_VISION_METHOD);
  const methods =
    vision.length === 0
      ? "текстовый слой"
      : vision.length === pages.length
        ? "разбор изображения"
        : "текстовый слой и разбор изображения";
  return `${countCopy(pages.length, pageForms)} · ${methods}`;
}
