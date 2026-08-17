"use client";

import type { AnalyteArea } from "@veylta/contracts";
import {
  Activity,
  Beaker,
  Candy,
  Droplets,
  Egg,
  Filter,
  Flame,
  FlaskConical,
  HeartPulse,
  Hourglass,
  LayoutGrid,
  type LucideIcon,
  Magnet,
  Ribbon,
  Sun,
  TestTubes,
  Waves,
  Zap,
} from "lucide-react";
import type { AreaSummary, StatusCounts } from "../dossier-areas";
import { countCopy } from "../russian-plural";

export type DossierSelection = "all" | AnalyteArea;

interface DossierRailProps {
  readonly summaries: readonly AreaSummary[];
  readonly totals: StatusCounts;
  readonly selected: DossierSelection;
  readonly onSelect: (selection: DossierSelection) => void;
}

/** One glyph per area of the record; the rail reads like a table of contents. */
export const areaIcon: Record<AnalyteArea, LucideIcon> = {
  blood: Droplets,
  iron: Magnet,
  coagulation: Hourglass,
  lipids: HeartPulse,
  liver: Beaker,
  pancreas: FlaskConical,
  kidney: Filter,
  electrolytes: Zap,
  glucose: Candy,
  thyroid: Activity,
  hormones: Waves,
  inflammation: Flame,
  protein: Egg,
  vitamins: Sun,
  prostate: Ribbon,
  other: TestTubes,
};

function RailItem({
  icon: Icon,
  label,
  counts,
  selected,
  area,
  onSelect,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly counts: StatusCounts;
  readonly selected: boolean;
  readonly area: DossierSelection;
  readonly onSelect: (selection: DossierSelection) => void;
}) {
  const total = countCopy(counts.total, ["показатель", "показателя", "показателей"]);
  const name = `${label}: ${total}${counts.outside > 0 ? `, ${counts.outside} вне референса` : ""}`;
  return (
    <li>
      <button
        type="button"
        className={`dossier-rail__item${selected ? " is-selected" : ""}${counts.outside > 0 ? " has-outside" : ""}`}
        aria-label={name}
        aria-current={selected ? "true" : undefined}
        data-area={area}
        onClick={() => onSelect(area)}
      >
        <Icon size={17} aria-hidden="true" />
        <span className="dossier-rail__label">{label}</span>
        <span className="dossier-rail__count">{counts.total}</span>
        {counts.outside > 0 ? (
          <span className="dossier-rail__alert" title={`${counts.outside} вне референса`}>
            {counts.outside}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/**
 * The record's table of contents: every area with confirmed data in a fixed anatomical order,
 * its indicator count and — where the printed reference puts something outside — how many. The
 * first item is the whole record. What a clinician looks at first is decided by the marks, not
 * by the order.
 */
export function DossierRail({ summaries, totals, selected, onSelect }: DossierRailProps) {
  return (
    <nav className="dossier-rail" aria-label="Разделы досье" data-testid="dossier-rail">
      <ul>
        <RailItem
          icon={LayoutGrid}
          label="Всё досье"
          counts={totals}
          selected={selected === "all"}
          area="all"
          onSelect={onSelect}
        />
        {summaries.map((summary) => (
          <RailItem
            key={summary.area}
            icon={areaIcon[summary.area]}
            label={summary.label}
            counts={summary}
            selected={selected === summary.area}
            area={summary.area}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </nav>
  );
}
