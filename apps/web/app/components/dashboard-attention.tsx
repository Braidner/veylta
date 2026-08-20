import type { ProfileOverviewResponse } from "@veylta/contracts";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { attentionRemainderCopy, attentionRows } from "../dashboard-attention";
import { profileTabPath } from "../paths";
import { DossierSparkline } from "./dossier-sparkline";
import { GaugeTrack } from "./gauge-track";

/**
 * The indicators the record says are outside, each as the dossier draws one: the value on the
 * band its own source printed, its run behind it, how it moved and who reads it. A placement and
 * a name — never a grade, and never a scale the document did not carry.
 */
export function DashboardAttention({ overview }: { overview: ProfileOverviewResponse }) {
  const rows = attentionRows(overview);
  const remainder = attentionRemainderCopy(overview);
  if (rows.length === 0) return null;

  return (
    <div className="signal-cards">
      <ul aria-label="Показатели вне референса">
        {rows.map((row) => (
          <li className="signal-card" key={row.key} data-testid="signal-card">
            <Link className="signal-card__head" href={row.href}>
              <strong title={row.name}>{row.name}</strong>
              <b>{row.value}</b>
              <ArrowUpRight size={13} aria-hidden="true" strokeWidth={1.8} />
            </Link>
            <p className="signal-card__standing">{row.standing}</p>
            <GaugeTrack
              reading={row.reading}
              label={`${row.name}: ${row.standing}`}
              fallback={null}
            />
            {row.run.length > 1 ? (
              <DossierSparkline
                points={row.run}
                band={row.band}
                tone="watch"
                label={row.runLabel}
              />
            ) : null}
            <p className="signal-card__foot">
              {row.change === null ? null : <span>{row.change}</span>}
              <em>{row.reader}</em>
            </p>
          </li>
        ))}
      </ul>
      {remainder === null ? null : (
        <Link
          className="signal-cards__more"
          href={profileTabPath(overview.profile.handle, "dossier")}
        >
          {remainder}
        </Link>
      )}
    </div>
  );
}
