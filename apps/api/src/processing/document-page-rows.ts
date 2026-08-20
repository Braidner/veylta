import type { DocumentPageUnreadReason } from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
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

/** One page of one analysis: its stable row id, its text, and why a picture on it went unread. */
export interface DocumentPageWrite {
  readonly id: string;
  readonly page: ParsedDocumentPage;
  /** Null whenever the page was read — by its own text layer or by the vision pass. */
  readonly unreadReason: DocumentPageUnreadReason | null;
}

/**
 * Writes one page's provenance, or proves the stored row already says exactly the same. Page
 * rows are immutable, so a rerun of the same analysis must land on identical bytes; anything
 * else is a conflict the caller must surface rather than overwrite.
 */
export async function insertOrVerifyPage(
  client: DatabaseClient,
  scope: { readonly familyId: string; readonly documentVersionId: string },
  entry: DocumentPageWrite,
  createdAt: string,
): Promise<void> {
  const { id, page, unreadReason } = entry;
  await client.query(
    `INSERT INTO document_pages
       (id, family_id, document_version_id, page_number, extracted_text,
        extraction_method, extraction_version, text_sha256, unread_reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (family_id, document_version_id, page_number) DO NOTHING`,
    [
      id,
      scope.familyId,
      scope.documentVersionId,
      page.pageNumber,
      page.text,
      page.extractionMethod,
      page.extractionVersion,
      page.textSha256,
      unreadReason,
      createdAt,
    ],
  );
  const row = (
    await client.query<DocumentPageRow>(
      `SELECT id, page_number, extracted_text, extraction_method, extraction_version,
              text_sha256, unread_reason
         FROM document_pages
        WHERE family_id = $1 AND document_version_id = $2 AND page_number = $3`,
      [scope.familyId, scope.documentVersionId, page.pageNumber],
    )
  ).rows[0];
  if (
    row === undefined ||
    row.id !== id ||
    Number(row.page_number) !== page.pageNumber ||
    row.extracted_text !== page.text ||
    row.extraction_method !== page.extractionMethod ||
    row.extraction_version !== page.extractionVersion ||
    row.text_sha256 !== page.textSha256 ||
    row.unread_reason !== unreadReason
  ) {
    throw new ProcessingPersistenceConflictError();
  }
}
