import {
  DOCUMENT_PAGE_UNREAD_REASONS,
  type DocumentPageReading,
  type DocumentPageUnreadReason,
} from "@veylta/contracts";
import type { Queryable } from "../database/pool.js";
import { ObjectStorageIntegrityError } from "../storage/object-storage.js";

interface DocumentPageReadingRow {
  page_number: number;
  extraction_method: string;
  unread_reason: string | null;
}

const unreadReasons = new Set<string>(DOCUMENT_PAGE_UNREAD_REASONS);

function unreadReason(value: string | null): DocumentPageUnreadReason | null {
  if (value === null) return null;
  if (!unreadReasons.has(value)) {
    throw new ObjectStorageIntegrityError("Stored document page unread reason is invalid");
  }
  return value as DocumentPageUnreadReason;
}

/**
 * What read each page of the document's stored analysis, in page order. Empty while no analysis
 * has stored pages yet. The reason a page went unread is the code the server wrote when the run
 * completed; it is never a sentence, and it is read back against the closed vocabulary.
 */
export async function pageReadingsForDocument(
  client: Queryable,
  scope: { readonly family_id: string; readonly document_version_id: string },
): Promise<readonly DocumentPageReading[]> {
  const rows = await client.query<DocumentPageReadingRow>(
    `SELECT page_number, extraction_method, unread_reason
       FROM document_pages
      WHERE family_id = $1 AND document_version_id = $2
      ORDER BY page_number`,
    [scope.family_id, scope.document_version_id],
  );
  return rows.rows.map((row) => ({
    pageNumber: Number(row.page_number),
    extractionMethod: row.extraction_method,
    unreadReason: unreadReason(row.unread_reason),
  }));
}
