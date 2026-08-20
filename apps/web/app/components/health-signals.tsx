import type { ProfileOverviewResponse } from "@veylta/contracts";
import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { signalChips, signalsStrip } from "../health-signals";
import { DashboardAttention } from "./dashboard-attention";

/** The whole record as one bar: three counted states, each segment carrying its own word. */
function SignalsStrip({ overview }: { overview: ProfileOverviewResponse }) {
  const strip = signalsStrip(overview);
  if (strip.total === 0) return <p className="signals-strip__empty">{strip.label}</p>;

  return (
    <div className="signals-strip">
      <div className="dossier-strip" role="img" aria-label={strip.label}>
        {strip.segments.map((segment) => (
          <span
            key={segment.key}
            className={`dossier-strip__segment is-${segment.key}`}
            style={{ flexGrow: segment.count }}
          />
        ))}
      </div>
      <ul className="signals-strip__legend">
        {strip.segments.map((segment) => (
          <li key={segment.key}>
            {segment.href === null ? (
              <span className={`signals-strip__word is-${segment.key}`}>{segment.label}</span>
            ) : (
              <Link className={`signals-strip__word is-${segment.key}`} href={segment.href}>
                {segment.label}
                <ArrowUpRight size={13} aria-hidden="true" strokeWidth={1.8} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Bookkeeping under the picture: what still waits for a decision, and how large the archive is. */
function SignalChips({ overview }: { overview: ProfileOverviewResponse }) {
  return (
    <ul className="signal-chips">
      {signalChips(overview).map((chip) => (
        <li key={chip.key}>
          {chip.href === null ? (
            <span className="signal-chip">{chip.label}</span>
          ) : (
            <Link className="signal-chip signal-chip--link" href={chip.href}>
              {chip.label}
              <ArrowUpRight size={13} aria-hidden="true" strokeWidth={1.8} />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the record looks like, not how much of it there is: the three states as a bar, then the
 * indicators standing outside, each placed on the band its own source printed. Never a score.
 */
export function HealthSignals({ overview }: { overview: ProfileOverviewResponse }) {
  return (
    <section className="health-signals" aria-labelledby="health-signals-title">
      <div className="dashboard-panel-heading">
        <div className="dashboard-panel-heading__icon" aria-hidden="true">
          <Activity size={21} strokeWidth={1.8} />
        </div>
        <div>
          <p>Что требует внимания</p>
          <h3 id="health-signals-title">Сигналы здоровья</h3>
        </div>
        <span className="health-signals__boundary">Без общего балла</span>
      </div>

      <SignalsStrip overview={overview} />
      <DashboardAttention overview={overview} />
      <SignalChips overview={overview} />
      <p className="health-signals__note">
        Оценка Veylta по печатным диапазонам ваших источников, а не диагноз — каждая ведёт к
        названному специалисту.
      </p>
    </section>
  );
}
