-- Why a picture printed on this page was never read, from the closed
-- DOCUMENT_PAGE_UNREAD_REASONS. NULL is the ordinary case and the only value an older row can
-- hold: the page was read, by its text layer or by the vision pass that transcribed it.
--
-- The column is nullable and carries no default, so ALTER TABLE adds it in place; the table's
-- immutability triggers see nothing, because a page row is still only ever inserted.
ALTER TABLE document_pages ADD COLUMN unread_reason TEXT CHECK (
  unread_reason IS NULL OR unread_reason IN ('image_page_limit', 'vision_unavailable')
);
