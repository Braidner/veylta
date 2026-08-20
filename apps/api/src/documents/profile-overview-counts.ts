import { indicatorKey, isOutsideRange, numberOf, pointStatus } from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { ProfileScope } from "../family/profile-access.js";

interface LatestObservationRow {
  canonical_code: string | null;
  source_name: string;
  source_unit: string;
  source_value: string;
  timeline_at: string;
  source_low: string | null;
  source_high: string | null;
  laboratory_out_of_range: number | null;
}

export interface ProfileOverviewCounts {
  readonly confirmed: number;
  readonly outsideIndicators: number;
}

const confirmedCountSql = `SELECT COUNT(*) AS confirmed_count
    FROM observations
   WHERE family_id = $1 AND patient_profile_id = $2 AND status = 'confirmed'`;

/**
 * The latest confirmed observation of each indicator group, newest first. The grouping is the
 * SQL half of `indicatorKey`; SQLite's `lower()` folds ASCII only, so a Cyrillic printed name
 * still needs the TypeScript keying below. Ordering mirrors the observation history:
 * `COALESCE(sampled_at, resulted_at, uploaded_at)` newest first, the id breaking a tie.
 */
const latestByIndicatorSql = `SELECT o.canonical_code,
                 o.source_name,
                 o.source_unit,
                 o.source_value,
                 COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at,
                 rr.source_low,
                 rr.source_high,
                 rr.laboratory_out_of_range
            FROM observations o
            LEFT JOIN observation_reference_ranges rr
              ON rr.family_id = o.family_id AND rr.observation_id = o.id
           WHERE o.family_id = $1
             AND o.patient_profile_id = $2
             AND o.status = 'confirmed'
             AND o.id = (
               SELECT latest.id
                 FROM observations latest
                WHERE latest.family_id = o.family_id
                  AND latest.patient_profile_id = o.patient_profile_id
                  AND latest.status = 'confirmed'
                  AND COALESCE(latest.canonical_code, latest.source_name)
                      = COALESCE(o.canonical_code, o.source_name)
                  AND latest.source_unit = o.source_unit
                ORDER BY COALESCE(latest.sampled_at, latest.resulted_at, latest.uploaded_at) DESC,
                         latest.id DESC
                LIMIT 1
             )
           ORDER BY timeline_at DESC, o.source_name, o.source_unit`;

/**
 * The two counts the overview states about the whole record: every confirmed observation, and how
 * many indicators currently sit outside — one per indicator whose latest confirmed value is
 * outside its printed range or flagged by the laboratory, never one per value.
 *
 * No number is parsed in SQL: `CAST('6,8' AS REAL)` is 6 and `CAST('< 0,1' AS REAL)` is 0, and
 * either would invent a value the document never printed. Rows come out of SQL, `pointStatus` —
 * the dossier's own rule — reads them here.
 */
export async function profileOverviewCounts(
  client: Pick<DatabaseClient, "query">,
  scope: ProfileScope,
): Promise<ProfileOverviewCounts> {
  const params = [scope.familyId, scope.profileId];
  const confirmed = (await client.query<{ confirmed_count: number }>(confirmedCountSql, params))
    .rows[0];
  const latest = await client.query<LatestObservationRow>(latestByIndicatorSql, params);
  // Two SQL groups can be one indicator when the printed names differ only in case, so the
  // newest of them decides; the query already returns the newest row of each group first.
  const newestByIndicator = new Map<string, LatestObservationRow>();
  for (const row of latest.rows) {
    const key = indicatorKey(row.canonical_code, row.source_name, row.source_unit);
    const held = newestByIndicator.get(key);
    if (held === undefined || row.timeline_at > held.timeline_at) newestByIndicator.set(key, row);
  }
  let outsideIndicators = 0;
  for (const row of newestByIndicator.values()) {
    const status = pointStatus(numberOf(row.source_value), {
      sourceLow: row.source_low,
      sourceHigh: row.source_high,
      laboratoryOutOfRange:
        row.laboratory_out_of_range === null ? null : row.laboratory_out_of_range === 1,
    });
    if (isOutsideRange(status)) outsideIndicators += 1;
  }
  return { confirmed: Number(confirmed?.confirmed_count ?? 0), outsideIndicators };
}
