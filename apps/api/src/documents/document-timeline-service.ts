import { randomUUID } from "node:crypto";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TIMELINE_CONTRACT_VERSION,
  type DocumentCategory,
  type DocumentTimelineEntry,
  type DocumentTimelineResponse,
  MAX_DOCUMENT_TIMELINE_DAYS,
  type SyntheticDocumentContentType,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import { DomainValidationError, type SessionActor } from "../family/family-service.js";
import {
  canonicalProfileScope,
  type ProfileScope,
  profileAccess,
} from "../family/profile-access.js";
import { effectiveDocumentDate, isCalendarDate } from "./document-date.js";
import { countsByDocument, type TimelineCounts } from "./document-timeline-counts.js";
import { type TimelineRow, timelineEntriesSql } from "./document-timeline-query.js";

/** No `before` given: a bound no calendar day the person can write ever reaches. */
const NO_BOUND = "9999-12-31";

const NO_COUNTS: TimelineCounts = { confirmed: 0, outside: 0, records: 0 };

function pageDays(limit: string | undefined): number {
  if (limit === undefined) return MAX_DOCUMENT_TIMELINE_DAYS;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DOCUMENT_TIMELINE_DAYS) {
    throw new DomainValidationError();
  }
  return parsed;
}

function beforeDay(before: string | undefined): string {
  if (before === undefined) return NO_BOUND;
  if (!isCalendarDate(before)) throw new DomainValidationError();
  return before;
}

function category(value: string | null): DocumentCategory | null {
  return value !== null && (DOCUMENT_CATEGORIES as readonly string[]).includes(value)
    ? (value as DocumentCategory)
    : null;
}

function timelineEntry(row: TimelineRow, counts: TimelineCounts): DocumentTimelineEntry {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    contentType: row.content_type as SyntheticDocumentContentType,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    effectiveDate: effectiveDocumentDate({
      override: row.document_date_override,
      documentDate: row.intelligence_document_date,
      uploadedAt: row.uploaded_at,
    }),
    category: category(row.category),
    title: row.title,
    shortSummary: row.short_summary,
    confirmedCount: counts.confirmed,
    outsideRangeCount: counts.outside,
    recordCount: counts.records,
  };
}

/**
 * Reviewed documents by effective date, a page being the `limit` most recent days before
 * `before` that carry one — with every entry of those days. Read-only; a session without read
 * access gets a 404. The query orders by the SQL twin of `effectiveDocumentDate`, and the
 * returned value is the TypeScript one, so the two must agree.
 */
export async function getDocumentTimeline(
  database: Database,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    before?: string | undefined;
    limit?: string | undefined;
    correlationId: string;
  },
): Promise<DocumentTimelineResponse> {
  const scope = canonicalProfileScope(input.scope);
  const days = pageDays(input.limit);
  const before = beforeDay(input.before);
  return database.transaction(async (client) => {
    await profileAccess(client, input.actor, scope);
    // One extra day tells whether an older page exists; its entries are not returned.
    const rows = (
      await client.query<TimelineRow>(timelineEntriesSql, [
        scope.familyId,
        scope.profileId,
        before,
        days + 1,
      ])
    ).rows;
    const distinctDays = [...new Set(rows.map((row) => row.effective_date))];
    const hasOlder = distinctDays.length > days;
    const oldestKept = hasOlder ? (distinctDays[days - 1] ?? null) : null;
    const kept =
      oldestKept === null ? rows : rows.filter((row) => row.effective_date >= oldestKept);
    const counts = await countsByDocument(
      client,
      scope,
      kept.map((row) => row.id),
    );
    const entries = kept.map((row) => timelineEntry(row, counts.get(row.id) ?? NO_COUNTS));
    await client.query(
      `INSERT INTO audit_events
         (id, family_id, actor_user_id, action, resource_type, resource_id, result,
          correlation_id, metadata, created_at)
       VALUES ($1, $2, $3, 'profile.timeline.opened', 'PatientProfile', $4, 'success', $5, $6, $7)`,
      [
        randomUUID(),
        scope.familyId,
        input.actor.userId,
        scope.profileId,
        input.correlationId,
        { contractVersion: DOCUMENT_TIMELINE_CONTRACT_VERSION },
        new Date(),
      ],
    );
    return {
      contractVersion: DOCUMENT_TIMELINE_CONTRACT_VERSION,
      entries,
      nextBefore: oldestKept,
    };
  });
}
