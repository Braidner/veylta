import type { ProfileOverviewResponse } from "@veylta/contracts";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { attentionRemainderCopy, attentionRows } from "../dashboard-attention";
import { profileTabPath } from "../paths";

/**
 * The indicators the record says are outside, named under the tiles. Each row is one placement
 * against the source's own bounds and the specialist who reads it — the way into that indicator's
 * history, never a verdict on it.
 */
export function DashboardAttention({ overview }: { overview: ProfileOverviewResponse }) {
  const rows = attentionRows(overview);
  const remainder = attentionRemainderCopy(overview);
  if (rows.length === 0) return null;

  return (
    <div className="health-signals__attention">
      <ul aria-label="Показатели вне референса">
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href}>
              <span className="health-signals__attention-name">
                <strong>{row.name}</strong>
                <b>{row.value}</b>
              </span>
              <span className="health-signals__attention-standing">
                {row.standing}
                {row.change === null ? null : <i>{row.change}</i>}
              </span>
              <span className="health-signals__attention-reader">
                {row.reader}
                <ArrowUpRight size={13} aria-hidden="true" strokeWidth={1.8} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {remainder === null ? null : (
        <Link
          className="health-signals__attention-more"
          href={profileTabPath(overview.profile.handle, "dossier")}
        >
          {remainder}
        </Link>
      )}
    </div>
  );
}
