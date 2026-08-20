import {
  analyteSpecialty,
  indicatorKey,
  numberOf,
  type ProfileOverviewAttention,
  type ProfileOverviewResponse,
} from "@veylta/contracts";
import { specialtyLabel } from "./assistant";
import { printedDelta } from "./dossier-numbers";
import { formatSampleDay } from "./format-moment";
import { historyPath, profileTabPath } from "./paths";

/**
 * One indicator the overview says is outside, read as a row: the value as the source printed it,
 * where it stands against the printed bounds, how it moved, and who reads it. A placement and a
 * name — never a grade, a category or an interpretation.
 */
export interface DashboardAttentionRow {
  readonly key: string;
  readonly name: string;
  /** «5,8 мЕд/л»; a unitless indicator carries the mark the source printed in its place. */
  readonly value: string;
  readonly standing: string;
  /** «+2,1 с 14 мая» — null while there is no previous value that can be compared. */
  readonly change: string | null;
  /** Who reads this indicator; the therapist when the catalog names no one. */
  readonly reader: string;
  readonly href: string;
}

/** What the record says the value does, from the status and the bounds the source printed. */
function standingOf(entry: ProfileOverviewAttention): string {
  if (entry.range === null) {
    return entry.status === "flagged"
      ? "лаборатория отметила значение вне диапазона"
      : "референс не напечатан";
  }
  if (entry.status === "above") return `выше ${entry.range}`;
  if (entry.status === "below") return `ниже ${entry.range}`;
  return "лаборатория отметила значение";
}

/**
 * The change over the last two points of the run; two values that are not plain numbers do not
 * compare. The run's last point is the entry's own value, so the one before it is the comparison.
 */
function changeOf(entry: ProfileOverviewAttention): string | null {
  const previous = entry.points[entry.points.length - 2];
  if (previous === undefined) return null;
  const latest = numberOf(entry.value);
  const before = numberOf(previous.value);
  if (latest === null || before === null) return null;
  const delta = printedDelta(
    { printed: entry.value, value: latest },
    { printed: previous.value, value: before },
  );
  const day = formatSampleDay(previous.at);
  return delta.direction === "unchanged" ? `без изменений с ${day}` : `${delta.value} с ${day}`;
}

/**
 * The indicators the overview names, each leading to its own history — or, without a catalog
 * code, to the dossier, where the printed name is the only handle there is.
 */
export function attentionRows(overview: ProfileOverviewResponse): DashboardAttentionRow[] {
  const { handle } = overview.profile;
  return overview.attention.map((entry) => {
    const specialty = analyteSpecialty(entry.canonicalCode, null);
    return {
      key: indicatorKey(entry.canonicalCode, entry.name, entry.unit),
      name: entry.name,
      value: `${entry.value} ${entry.unit}`,
      standing: standingOf(entry),
      change: changeOf(entry),
      reader: specialty === null ? "терапевт" : specialtyLabel[specialty],
      href:
        entry.canonicalCode === null
          ? profileTabPath(handle, "dossier")
          : historyPath(handle, entry.canonicalCode),
    };
  });
}

/** «и ещё 4» — the count the rows do not name, since the overview shows only a few. */
export function attentionRemainderCopy(overview: ProfileOverviewResponse): string | null {
  const remainder = overview.outsideIndicatorCount - overview.attention.length;
  return remainder > 0 ? `и ещё ${remainder}` : null;
}
