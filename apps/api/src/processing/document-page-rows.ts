import { DOCUMENT_PAGE_VISION_METHOD, type DocumentPageUnreadReason } from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { UnreadDocumentPage } from "./document-intelligence-provider.js";
import {
  type CitingAnalysis,
  type DocumentVersionScope,
  pagesAlreadyRead,
  pagesReadByAnalysis,
} from "./document-page-evidence.js";
import { ProcessingPersistenceConflictError } from "./processing-errors.js";
import type { ParsedDocumentPage } from "./synthetic-lab-parser.js";

interface DocumentPageRow {
  id: string;
  page_number: number;
  extracted_text: string;
  extraction_method: string;
  extraction_version: string;
  text_sha256: string;
  unread_reason: string | null;
}

/** How one page was read, and why a picture on it went unread. */
export interface DocumentPageReadingWrite {
  readonly text: string;
  readonly extractionMethod: string;
  readonly extractionVersion: string;
  readonly textSha256: string;
  /** Null whenever the page was read — by its own text layer or by the vision pass. */
  readonly unreadReason: DocumentPageUnreadReason | null;
}

/** One page of one analysis: its stable row id and the reading that analysis brings. */
export interface DocumentPageWrite {
  readonly id: string;
  readonly page: ParsedDocumentPage;
  readonly unreadReason: DocumentPageUnreadReason | null;
}

export interface AnalysisPageWrites {
  readonly pages: readonly DocumentPageWrite[];
  /** The page numbers this analysis read its own facts and results from. */
  readonly readByAnalysis: ReadonlySet<number>;
}

/** One completing analysis, as far as its pages go. */
type PagedAnalysis = CitingAnalysis & {
  readonly pages: readonly ParsedDocumentPage[];
  readonly unreadPages?: readonly UnreadDocumentPage[];
};

/**
 * The page rows one analysis asks for: its own pages under stable ids, each carrying why the
 * analysis could not read it. Only an analysis merged out of several passes names an unread
 * page; one provider run reads every page it was given.
 */
export function analysisPageWrites(
  analysis: PagedAnalysis,
  pageId: (page: ParsedDocumentPage) => string,
): AnalysisPageWrites {
  const unread = new Map(
    (analysis.unreadPages ?? []).map((page) => [page.pageNumber, page.reason]),
  );
  return {
    pages: analysis.pages.map((page) => ({
      id: pageId(page),
      page,
      unreadReason: unread.get(page.pageNumber) ?? null,
    })),
    readByAnalysis: pagesReadByAnalysis(analysis),
  };
}

/**
 * What a stored page row and the reading a completing analysis brings do to each other:
 * `stored` leaves the row as it is, `reread` replaces its reading in place under the same id.
 */
export type PageWriteDecision = "stored" | "reread" | "conflict";

function isVision(reading: DocumentPageReadingWrite): boolean {
  return reading.extractionMethod === DOCUMENT_PAGE_VISION_METHOD;
}

function sameReading(stored: DocumentPageReadingWrite, next: DocumentPageReadingWrite): boolean {
  return (
    stored.text === next.text &&
    stored.extractionMethod === next.extractionMethod &&
    stored.extractionVersion === next.extractionVersion &&
    stored.textSha256 === next.textSha256
  );
}

/**
 * Page provenance is immutable *for anything that was read from it*; a page nothing was read
 * from is not evidence yet, and its reading may be replaced by a better one. `alreadyRead` is
 * that guard over the runs before this one, `readByAnalysis` over the analysis being written —
 * a fact cites the text of its page, so the row has to hold exactly the text it was read from.
 *
 * Under the guard exactly two moves are allowed: a picture page a text pass could not read
 * becomes the vision pass's transcription of it, and the closed reason beside a page moves.
 * A text page whose text merely differs is a defect, not a reading, and stays a conflict.
 * The one move the guard does not gate is the opposite direction: a later text pass does not
 * un-read what a vision pass transcribed, so the stored reading simply stands.
 */
export function pageWriteDecision(
  stored: DocumentPageReadingWrite,
  next: DocumentPageReadingWrite,
  evidence: { readonly alreadyRead: boolean; readonly readByAnalysis: boolean },
): PageWriteDecision {
  const reading = sameReading(stored, next);
  if (reading && stored.unreadReason === next.unreadReason) return "stored";
  if (!reading && isVision(stored) && !isVision(next)) {
    return evidence.readByAnalysis ? "conflict" : "stored";
  }
  if (evidence.alreadyRead) return "conflict";
  if (reading) return "reread";
  return isVision(next) ? "reread" : "conflict";
}

function readingOf(entry: DocumentPageWrite): DocumentPageReadingWrite {
  return {
    text: entry.page.text,
    extractionMethod: entry.page.extractionMethod,
    extractionVersion: entry.page.extractionVersion,
    textSha256: entry.page.textSha256,
    unreadReason: entry.unreadReason,
  };
}

function storedReading(row: DocumentPageRow): DocumentPageReadingWrite {
  return {
    text: row.extracted_text,
    extractionMethod: row.extraction_method,
    extractionVersion: row.extraction_version,
    textSha256: row.text_sha256,
    unreadReason: row.unread_reason as DocumentPageUnreadReason | null,
  };
}

async function insertPage(
  client: DatabaseClient,
  scope: DocumentVersionScope,
  entry: DocumentPageWrite,
  createdAt: string,
): Promise<DocumentPageRow> {
  await client.query(
    `INSERT INTO document_pages
       (id, family_id, document_version_id, page_number, extracted_text,
        extraction_method, extraction_version, text_sha256, unread_reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (family_id, document_version_id, page_number) DO NOTHING`,
    [
      entry.id,
      scope.familyId,
      scope.documentVersionId,
      entry.page.pageNumber,
      entry.page.text,
      entry.page.extractionMethod,
      entry.page.extractionVersion,
      entry.page.textSha256,
      entry.unreadReason,
      createdAt,
    ],
  );
  const row = (
    await client.query<DocumentPageRow>(
      `SELECT id, page_number, extracted_text, extraction_method, extraction_version,
              text_sha256, unread_reason
         FROM document_pages
        WHERE family_id = $1 AND document_version_id = $2 AND page_number = $3`,
      [scope.familyId, scope.documentVersionId, entry.page.pageNumber],
    )
  ).rows[0];
  if (row === undefined || row.id !== entry.id || Number(row.page_number) !== entry.page.pageNumber)
    throw new ProcessingPersistenceConflictError();
  return row;
}

/** Replaces a page's reading under its own row id, so every fact keeps the page it binds to. */
async function rereadPage(
  client: DatabaseClient,
  scope: DocumentVersionScope,
  entry: DocumentPageWrite,
): Promise<void> {
  const updated = await client.query(
    `UPDATE document_pages
        SET extracted_text = $4, extraction_method = $5, extraction_version = $6,
            text_sha256 = $7, unread_reason = $8
      WHERE family_id = $1 AND document_version_id = $2 AND page_number = $3`,
    [
      scope.familyId,
      scope.documentVersionId,
      entry.page.pageNumber,
      entry.page.text,
      entry.page.extractionMethod,
      entry.page.extractionVersion,
      entry.page.textSha256,
      entry.unreadReason,
    ],
  );
  if (updated.rowCount !== 1) throw new ProcessingPersistenceConflictError();
}

/**
 * Writes the pages of one analysis: each row is inserted, left as it stands, or re-read in
 * place, by `pageWriteDecision` over the pages something has already been read from. The
 * guard is read once for the whole document version rather than restated per page.
 */
export async function writeAnalysisPages(
  client: DatabaseClient,
  scope: DocumentVersionScope,
  analysis: AnalysisPageWrites,
  createdAt: string,
): Promise<void> {
  const alreadyRead = await pagesAlreadyRead(client, scope);
  for (const entry of analysis.pages) {
    const row = await insertPage(client, scope, entry, createdAt);
    const decision = pageWriteDecision(storedReading(row), readingOf(entry), {
      alreadyRead: alreadyRead.has(entry.page.pageNumber),
      readByAnalysis: analysis.readByAnalysis.has(entry.page.pageNumber),
    });
    if (decision === "conflict") throw new ProcessingPersistenceConflictError();
    if (decision === "reread") await rereadPage(client, scope, entry);
  }
}
