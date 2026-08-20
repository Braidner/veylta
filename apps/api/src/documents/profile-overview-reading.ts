import {
  indicatorKey,
  isOutsideRange,
  MAX_PROFILE_OVERVIEW_ATTENTION,
  MAX_PROFILE_OVERVIEW_POINTS,
  numberOf,
  type PointStatus,
  type ProfileOverviewAttention,
  pointStatus,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { ProfileScope } from "../family/profile-access.js";

interface IndicatorReadingRow {
  canonical_code: string | null;
  source_name: string;
  source_unit: string;
  source_value: string;
  timeline_at: string;
  reference_source_text: string | null;
  source_low: string | null;
  source_high: string | null;
  laboratory_out_of_range: number | null;
}

/**
 * Where the record puts one indicator's latest value. The three buckets partition it: every
 * indicator lands in exactly one, so the counts add up to the record without a fourth pass.
 */
type IndicatorBucket = "within" | "outside" | "unknown";

const bucketOf = (status: PointStatus): IndicatorBucket =>
  isOutsideRange(status) ? "outside" : status === "unknown" ? "unknown" : "within";

export interface ProfileOverviewReading {
  readonly confirmed: number;
  readonly indicators: Readonly<Record<IndicatorBucket, number>>;
  readonly attention: readonly ProfileOverviewAttention[];
}

const confirmedCountSql = `SELECT COUNT(*) AS confirmed_count
    FROM observations
   WHERE family_id = $1 AND patient_profile_id = $2 AND status = 'confirmed'`;

/**
 * The last confirmed observations of each indicator group, newest first: the latest is what the
 * record says now, the ones behind it are its run. The grouping is the SQL half of `indicatorKey`;
 * SQLite's `lower()` folds ASCII only, so a Cyrillic printed name still needs the TypeScript keying
 * below. Ordering mirrors the observation history:
 * `COALESCE(sampled_at, resulted_at, uploaded_at)` newest first, the id breaking a tie.
 */
const latestByIndicatorSql = `SELECT canonical_code, source_name, source_unit, source_value,
                 timeline_at, reference_source_text, source_low, source_high,
                 laboratory_out_of_range
            FROM (
              SELECT o.canonical_code,
                     o.source_name,
                     o.source_unit,
                     o.source_value,
                     COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at,
                     rr.source_text AS reference_source_text,
                     rr.source_low,
                     rr.source_high,
                     rr.laboratory_out_of_range,
                     ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(o.canonical_code, o.source_name), o.source_unit
                       ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC,
                                o.id DESC
                     ) AS recency
                FROM observations o
                LEFT JOIN observation_reference_ranges rr
                  ON rr.family_id = o.family_id AND rr.observation_id = o.id
               WHERE o.family_id = $1
                 AND o.patient_profile_id = $2
                 AND o.status = 'confirmed'
            )
           WHERE recency <= ${MAX_PROFILE_OVERVIEW_POINTS}
           ORDER BY timeline_at DESC, source_name, source_unit, recency`;

function statusOf(row: IndicatorReadingRow): PointStatus {
  return pointStatus(numberOf(row.source_value), {
    sourceLow: row.source_low,
    sourceHigh: row.source_high,
    laboratoryOutOfRange:
      row.laboratory_out_of_range === null ? null : row.laboratory_out_of_range === 1,
  });
}

/** The source's own sentence for the bounds when it printed one, else the bounds it named. */
function printedRange(row: IndicatorReadingRow): string | null {
  if (row.reference_source_text !== null) return row.reference_source_text;
  const bounds = [row.source_low, row.source_high].filter(
    (bound): bound is string => bound !== null,
  );
  return bounds.length === 0 ? null : bounds.join(" – ");
}

/** `newestFirst` holds the indicator's run as the query returned it; `points` reads oldest first. */
function attentionOf(
  latest: IndicatorReadingRow,
  newestFirst: readonly IndicatorReadingRow[],
  status: PointStatus,
): ProfileOverviewAttention {
  return {
    canonicalCode: latest.canonical_code,
    name: latest.source_name,
    value: latest.source_value,
    unit: latest.source_unit,
    status,
    range: printedRange(latest),
    points: [...newestFirst]
      .reverse()
      .map((row) => ({ value: row.source_value, at: row.timeline_at })),
  };
}

/**
 * What the overview states about the whole record: every confirmed observation, where each
 * indicator's latest value stands — within, outside, or nowhere the record can place it, counted
 * per indicator and never per value — and which of the outside ones to name, with its run.
 *
 * No number is parsed in SQL: `CAST('6,8' AS REAL)` is 6 and `CAST('< 0,1' AS REAL)` is 0, and
 * either would invent a value the document never printed. Rows come out of SQL, `pointStatus` —
 * the dossier's own rule — reads them here.
 */
export async function profileOverviewReading(
  client: Pick<DatabaseClient, "query">,
  scope: ProfileScope,
): Promise<ProfileOverviewReading> {
  const params = [scope.familyId, scope.profileId];
  const confirmed = (await client.query<{ confirmed_count: number }>(confirmedCountSql, params))
    .rows[0];
  const latest = await client.query<IndicatorReadingRow>(latestByIndicatorSql, params);
  // Two SQL groups can be one indicator when the printed names differ only in case, so the query's
  // own order decides: it already returns every row newest first, the newest of a key leading.
  const byIndicator = new Map<string, IndicatorReadingRow[]>();
  for (const row of latest.rows) {
    const key = indicatorKey(row.canonical_code, row.source_name, row.source_unit);
    const held = byIndicator.get(key);
    if (held === undefined) byIndicator.set(key, [row]);
    else if (held.length < MAX_PROFILE_OVERVIEW_POINTS) held.push(row);
  }
  const indicators: Record<IndicatorBucket, number> = { within: 0, outside: 0, unknown: 0 };
  const attention: ProfileOverviewAttention[] = [];
  for (const run of byIndicator.values()) {
    const [latestRow] = run;
    if (latestRow === undefined) continue;
    const status = statusOf(latestRow);
    indicators[bucketOf(status)] += 1;
    if (isOutsideRange(status) && attention.length < MAX_PROFILE_OVERVIEW_ATTENTION) {
      attention.push(attentionOf(latestRow, run, status));
    }
  }
  return { confirmed: Number(confirmed?.confirmed_count ?? 0), indicators, attention };
}
