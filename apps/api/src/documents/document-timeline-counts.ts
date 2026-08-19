import { isOutsideRange, numberOf, pointStatus } from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { ProfileScope } from "../family/profile-access.js";
import { observationRowsSql, recordCountsSql } from "./document-timeline-query.js";

interface ObservationRow {
  document_id: string;
  source_value: string;
  source_low: string | null;
  source_high: string | null;
  laboratory_out_of_range: number | null;
}

export interface TimelineCounts {
  confirmed: number;
  outside: number;
  records: number;
}

/**
 * What a timeline entry shows beside its date: confirmed observations, how many of them sit
 * outside their printed range, and confirmed clinician records. `pointStatus` is the dossier's
 * rule, so a value reads the same here as it does there.
 */
export async function countsByDocument(
  client: Pick<DatabaseClient, "query">,
  scope: ProfileScope,
  ids: readonly string[],
): Promise<Map<string, TimelineCounts>> {
  const counts = new Map<string, TimelineCounts>(
    ids.map((id) => [id, { confirmed: 0, outside: 0, records: 0 }]),
  );
  if (ids.length === 0) return counts;
  const params = [scope.familyId, scope.profileId, ...ids];
  const observations = await client.query<ObservationRow>(observationRowsSql(ids.length), params);
  for (const row of observations.rows) {
    const entry = counts.get(row.document_id);
    if (entry === undefined) continue;
    entry.confirmed += 1;
    const status = pointStatus(numberOf(row.source_value), {
      sourceLow: row.source_low,
      sourceHigh: row.source_high,
      laboratoryOutOfRange:
        row.laboratory_out_of_range === null ? null : row.laboratory_out_of_range === 1,
    });
    if (isOutsideRange(status)) entry.outside += 1;
  }
  const records = await client.query<{ document_id: string; record_count: number }>(
    recordCountsSql(ids.length),
    params,
  );
  for (const row of records.rows) {
    const entry = counts.get(row.document_id);
    if (entry !== undefined) entry.records = Number(row.record_count);
  }
  return counts;
}
