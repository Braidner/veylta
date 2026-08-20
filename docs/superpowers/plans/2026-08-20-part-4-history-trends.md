# Part 4 — History: Trends and «Что изменилось» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The history tab becomes a reading instrument: a «Что изменилось» summary over a chosen period, a rail of the record's indicators with sparklines and deltas, a chart of the selected indicator against its printed reference band, and the confirmed-values table below — all from data the app already has.

**Architecture:** No new API. The workspace loads the full paged observation history plus the medical profile's sex exactly the way `dossier-panel.tsx` does, builds `DossierSeries[]` with the existing `buildDossierSeries`, and everything else is pure modules over those series: `app/history-summary.ts` (periods and the four buckets), `app/history-chart.ts` (SVG geometry: stepped reference band, status-coloured points, ticks). Components `history-workspace.tsx` → `history-summary.tsx` + `history-rail.tsx` + `history-chart.tsx` + the existing row moved out of `veylta-app.tsx` as `observation-history-row.tsx`; the old `ObservationHistoryPanel`/`IndicatorCatalogPanel`/`IndicatorSeriesPanel` (~700 lines) leave `veylta-app.tsx`. Selection is driven by `?code=` (already parsed by `profile-route-parse.ts` into `requestedCanonicalCode`) and by clicks.

**Tech Stack:** TypeScript strict, Next.js 16 / React 19, plain SVG (no chart library), `node:test` + `node:assert/strict`, Playwright e2e on the synthetic stand.

**Spec:** `docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md` — «Part 4 — history: trends and «what changed»» (lines 198–234) + «Delivery, verification, boundaries». Parts 1–3 are delivered.

## Global Constraints

- **No new API, no contract change.** `observation-history/v1` and `indicator-series/v1` stay; the per-code `GET …/indicators/:code` endpoint keeps serving `DocumentIndicatorHistory` (the document page sidebar), which stays in `veylta-app.tsx` untouched.
- **Facts only, by the dossier's rule.** Status per point is `pointStatus` from `@veylta/contracts` (already applied inside `buildDossierSeries`); «вне референса» is `isOutsideRange`. No score, ring, rating, or unexplained colour (DESIGN.md L55); every semantic colour is paired with a label; dates and units appear beside values, never only in a tooltip (DESIGN.md L63) — the table below the chart carries the full data, so the chart's hover/focus is auxiliary.
- **Units are never converted:** two printed units of one code are two series (that is what `buildDossierSeries` already produces — its key is `` `${code ?? lowerName}|${source.unit}` ``); the chart offers unit chips when several series share the selected code.
- **Summary buckets, one deterministic rule** (the pure module's contract): for each series, `pointsIn` = points with `at >= periodStart` (all points when the period is «всё»); a series with no point in the period is not counted. `baseline` = the last point before `periodStart`, else `pointsIn[0]`. If `baseline === latest` (single measurement, nothing before) → «впервые измерено». Else compare `isOutsideRange(baseline.status)` to `isOutsideRange(latest.status)`: false→true «вышли за референс», true→false «вернулись в референс», else «без изменений». Periods: «3 мес» / «6 мес» / «Год» / «Всё», computed by UTC month arithmetic from an injected `now`.
- **No calendar-date flakes:** the fake codex pins `sampledAt = 2026-08-10`, so an e2e must never assert period-dependent counts under a bounded period (a CI run months later would flip them); count assertions only under «Всё», the switch itself asserted by state, not by counts.
- **Anchors survive:** the header's «Поиск по архиву» and the dashboard's «Найти показатель» link to `#indicator-catalog`; the document page's «Открыть всю историю» links to `…?code=<code>#observation-history`. The new page keeps an element `id="indicator-catalog"` on the rail (its filter field) and `id="observation-history"` with the accessible region name «История подтверждённых значений» on the table — `e2e/dashboard-redesign.spec.ts:88` pins that region name and must stay green.
- `pnpm lint` ratchet: `apps/web/app/components/veylta-app.tsx` baseline is now **6831** (lowered after Part 3) — it may only shrink; `config/file-length-baseline.json` is never edited by hand mid-plan (a `pnpm lint:lines --write` hygiene commit comes after the final push, as in Part 3); every new file ≤ 250 lines.
- UI text Russian; code/comments/commits English; web imports extensionless; `exactOptionalPropertyTypes` conditional spreads; `node:test` + `node:assert/strict`; synthetic data only; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` on every commit.
- After this part lands, `docs/media/*.png` are regenerated and committed (the deferred decision from Parts 1–3): Task 6 runs the README screenshot specs and commits the refreshed media.

---

### Task 1: `app/history-summary.ts` — periods, buckets, copy; `seriesKeyOf` exported from the dossier

**Files:**
- Create: `apps/web/app/history-summary.ts`, `apps/web/app/history-summary.test.ts`
- Modify: `apps/web/app/dossier.ts` (export `seriesKeyOf`), `apps/web/app/dossier.test.ts` (one assertion)

**Interfaces:**
- Consumes: `DossierSeries`, `SeriesPoint` (`./dossier`), `isOutsideRange` (`@veylta/contracts`), `pluralForm`/`countCopy` (`./russian-plural`).
- Produces: `HISTORY_PERIODS`, `HistoryPeriod = "3m" | "6m" | "12m" | "all"`, `historyPeriodLabel: Record<HistoryPeriod, string>` («3 мес», «6 мес», «Год», «Всё»), `periodStart(period, now: Date): string | null` (an ISO instant, or null for «всё»), `HISTORY_BUCKETS`, `HistoryBucketKind = "moved_outside" | "returned_inside" | "unchanged" | "first_measured"`, `historyBucketLabel: Record<HistoryBucketKind, string>` («Вышли за референс», «Вернулись в референс», «Без изменений», «Впервые измерены»), `HistorySummaryBucket { kind; series: readonly DossierSeries[] }`, `HistorySummary { buckets: readonly HistorySummaryBucket[]; measuredCount: number }`, `historySummary(series, period, now): HistorySummary`, `defaultSelectionKey(series: readonly DossierSeries[]): string | null` (the first series in rail order whose current `status` is outside, else the first; rail order = the input order, which `buildDossierSeries` already sorts by key); `seriesKeyOf(item: ObservationHistoryItem): string` (from `dossier.ts` — the same key `buildDossierSeries` uses).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/history-summary.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildDossierSeries } from "./dossier";
import { observation } from "./dossier.fixture";
import {
  defaultSelectionKey,
  historyPeriodLabel,
  historySummary,
  periodStart,
} from "./history-summary";

const now = new Date("2026-08-20T12:00:00.000Z");

test("period starts are UTC month arithmetic; «всё» has no bound", () => {
  assert.equal(periodStart("3m", now), "2026-05-20T12:00:00.000Z");
  assert.equal(periodStart("6m", now), "2026-02-20T12:00:00.000Z");
  assert.equal(periodStart("12m", now), "2025-08-20T12:00:00.000Z");
  assert.equal(periodStart("all", now), null);
  assert.equal(historyPeriodLabel["12m"], "Год");
});

test("the four buckets: moved out, returned, unchanged, first measured — by the dossier's status rule", () => {
  const series = buildDossierSeries(
    [
      // tsh: within long ago, above now → moved outside (baseline = the point before the period).
      observation({ id: "t1", code: "tsh", value: "2,0", at: "2025-01-10T08:00:00.000Z" }),
      observation({ id: "t2", code: "tsh", value: "9,9", at: "2026-08-10T08:00:00.000Z" }),
      // ferritin: above long ago, within now → returned inside.
      observation({ id: "f1", code: "ferritin", name: "Ферритин", value: "9,0", at: "2025-01-10T08:00:00.000Z" }),
      observation({ id: "f2", code: "ferritin", name: "Ферритин", value: "2,2", at: "2026-08-10T08:00:00.000Z" }),
      // glucose: within → within, both inside the period → unchanged (baseline = first in period).
      observation({ id: "g1", code: "glucose.fasting", name: "Глюкоза", value: "2,0", at: "2026-07-01T08:00:00.000Z" }),
      observation({ id: "g2", code: "glucose.fasting", name: "Глюкоза", value: "2,4", at: "2026-08-10T08:00:00.000Z" }),
      // ldl: a single measurement in the period, nothing before → first measured.
      observation({ id: "l1", code: "cholesterol.ldl", name: "ЛПНП", value: "3,0", at: "2026-08-01T08:00:00.000Z" }),
      // hemoglobin: measured only before the period → not counted.
      observation({ id: "h1", code: "hemoglobin", name: "Гемоглобин", value: "2,0", at: "2024-01-10T08:00:00.000Z" }),
    ],
    null,
  );
  const summary = historySummary(series, "6m", now);
  const byKind = Object.fromEntries(
    summary.buckets.map((bucket) => [bucket.kind, bucket.series.map((entry) => entry.code)]),
  );
  assert.deepEqual(byKind, {
    moved_outside: ["tsh"],
    returned_inside: ["ferritin"],
    unchanged: ["glucose.fasting"],
    first_measured: ["cholesterol.ldl"],
  });
  assert.equal(summary.measuredCount, 4, "the hemoglobin series has no point in the period");
});

test("«всё» compares the first-ever point to the latest; a one-point series is first-measured", () => {
  const series = buildDossierSeries(
    [
      observation({ id: "a1", value: "2,0", at: "2024-01-10T08:00:00.000Z" }),
      observation({ id: "a2", value: "9,9", at: "2026-08-10T08:00:00.000Z" }),
      observation({ id: "b1", code: "ferritin", name: "Ферритин", value: "3,0", at: "2026-08-10T08:00:00.000Z" }),
    ],
    null,
  );
  const summary = historySummary(series, "all", now);
  const byKind = Object.fromEntries(
    summary.buckets.map((bucket) => [bucket.kind, bucket.series.map((entry) => entry.code)]),
  );
  assert.deepEqual(byKind.moved_outside, ["tsh"]);
  assert.deepEqual(byKind.first_measured, ["ferritin"]);
});

test("a point exactly on the boundary belongs to the period", () => {
  const series = buildDossierSeries(
    [
      observation({ id: "e1", value: "2,0", at: "2026-02-20T12:00:00.000Z" }),
    ],
    null,
  );
  const summary = historySummary(series, "6m", now);
  assert.equal(summary.measuredCount, 1);
});

test("the chart's default selection is the first outside series, else the first", () => {
  const calm = buildDossierSeries([observation({ id: "c", value: "2,2" })], null);
  const mixed = buildDossierSeries(
    [
      observation({ id: "w", code: "glucose.fasting", name: "Глюкоза", value: "2,2" }),
      observation({ id: "o", code: "tsh", value: "9,9" }),
    ],
    null,
  );
  assert.equal(defaultSelectionKey(calm), calm[0]?.key ?? null);
  assert.equal(defaultSelectionKey(mixed), mixed.find((s) => s.code === "tsh")?.key);
  assert.equal(defaultSelectionKey([]), null);
});
```

(`observation()` is `apps/web/app/dossier.fixture.ts` — defaults code `tsh`, value «6,8», printed range 0,4–4,0; overriding `value: "2,2"` puts it within, `"9,9"` above. Check the fixture's actual override keys — `code`, `name`, `value`, `at` exist.)

In `apps/web/app/dossier.test.ts` add one assertion in an existing test: `assert.equal(seriesKeyOf(items[0]), series[0].key)` with the import — pinning that the exported helper and the builder agree.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @veylta/web exec tsx --test app/history-summary.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/web/app/history-summary.ts
import { isOutsideRange } from "@veylta/contracts";
import type { DossierSeries, SeriesPoint } from "./dossier";

/** The summary's window: three calendar months, six, a year, or the whole record. */
export const HISTORY_PERIODS = ["3m", "6m", "12m", "all"] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

export const historyPeriodLabel: Record<HistoryPeriod, string> = {
  "3m": "3 мес",
  "6m": "6 мес",
  "12m": "Год",
  all: "Всё",
};

const periodMonths: Record<Exclude<HistoryPeriod, "all">, number> = { "3m": 3, "6m": 6, "12m": 12 };

/** The period's left edge as an ISO instant (UTC month arithmetic), or null for the whole record. */
export function periodStart(period: HistoryPeriod, now: Date): string | null {
  if (period === "all") return null;
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - periodMonths[period]);
  return start.toISOString();
}

export const HISTORY_BUCKETS = ["moved_outside", "returned_inside", "unchanged", "first_measured"] as const;
export type HistoryBucketKind = (typeof HISTORY_BUCKETS)[number];

export const historyBucketLabel: Record<HistoryBucketKind, string> = {
  moved_outside: "Вышли за референс",
  returned_inside: "Вернулись в референс",
  unchanged: "Без изменений",
  first_measured: "Впервые измерены",
};

export interface HistorySummaryBucket {
  readonly kind: HistoryBucketKind;
  readonly series: readonly DossierSeries[];
}

export interface HistorySummary {
  readonly buckets: readonly HistorySummaryBucket[];
  /** Series with at least one point in the period — the summary's denominator. */
  readonly measuredCount: number;
}

/**
 * What changed over the period, by the dossier's status rule and nothing else. The baseline is
 * the last value before the period (or the first inside it); a series measured once and never
 * before is «впервые измерено»; a series with no point in the period is not counted.
 */
export function historySummary(
  series: readonly DossierSeries[],
  period: HistoryPeriod,
  now: Date,
): HistorySummary {
  const start = periodStart(period, now);
  const buckets = new Map<HistoryBucketKind, DossierSeries[]>(
    HISTORY_BUCKETS.map((kind) => [kind, []]),
  );
  let measured = 0;
  for (const entry of series) {
    const inPeriod = start === null ? entry.points : entry.points.filter((point) => point.at >= start);
    const first = inPeriod[0];
    if (first === undefined) continue;
    measured += 1;
    const before: SeriesPoint | undefined =
      start === null ? undefined : [...entry.points].reverse().find((point) => point.at < start);
    const baseline = before ?? first;
    const latest = inPeriod[inPeriod.length - 1] ?? first;
    if (baseline === latest) {
      buckets.get("first_measured")?.push(entry);
      continue;
    }
    const wasOutside = isOutsideRange(baseline.status);
    const isOutside = isOutsideRange(latest.status);
    const kind: HistoryBucketKind =
      isOutside && !wasOutside ? "moved_outside" : !isOutside && wasOutside ? "returned_inside" : "unchanged";
    buckets.get(kind)?.push(entry);
  }
  return {
    buckets: HISTORY_BUCKETS.map((kind) => ({ kind, series: buckets.get(kind) ?? [] })),
    measuredCount: measured,
  };
}

/** With no `?code=`: the first indicator currently outside its reference, else the first at all. */
export function defaultSelectionKey(series: readonly DossierSeries[]): string | null {
  const outside = series.find((entry) => isOutsideRange(entry.status));
  return (outside ?? series[0])?.key ?? null;
}
```

In `apps/web/app/dossier.ts`, extract the internal key expression into an exported helper and use it inside `buildDossierSeries` (one definition):

```ts
/** The series identity: canonical code (or the printed name) plus the exact printed unit. */
export function seriesKeyOf(item: ObservationHistoryItem): string {
  return `${item.canonicalCode ?? item.source.name.toLocaleLowerCase("ru-RU")}|${item.source.unit}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @veylta/web exec tsx --test app/history-summary.test.ts app/dossier.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write apps/web/app
git add apps/web/app
git commit -m "feat(web): the «что изменилось» rule — periods, four buckets, the default selection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `app/history-chart.ts` — the chart's pure geometry

**Files:**
- Create: `apps/web/app/history-chart.ts`, `apps/web/app/history-chart.test.ts`

**Interfaces:**
- Consumes: `DossierSeries`, `SeriesPoint` (`./dossier`), `HistoryPeriod`, `periodStart` (`./history-summary`), `PointStatus` (`@veylta/contracts`), `formatSampleMoment` (`./format-moment`).
- Produces: `ChartPoint { x; y; status; observationId; documentId; printed; at; laboratory; rangeText }` (x/y in percent, y grows downward already inverted), `BandSegment { x1; x2; yTop; yBottom }` (percent; a segment per run of identical printed bounds — «stepped per value when the bounds differ between laboratories»), `AxisTick { x: number; label: string }`, `HistoryChartModel { points; band; ticks; yMinLabel; yMaxLabel; empty: "no_numeric" | null }`, `historyChartModel(series, period, now): HistoryChartModel`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/history-chart.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildDossierSeries } from "./dossier";
import { observation } from "./dossier.fixture";
import { historyChartModel } from "./history-chart";

const now = new Date("2026-08-20T12:00:00.000Z");

test("points are placed on the period's time axis with their status; the band steps when bounds change", () => {
  const [series] = buildDossierSeries(
    [
      observation({ id: "p1", value: "2,0", at: "2026-06-20T12:00:00.000Z" }),
      // The second laboratory prints a different range: the band must step, not average.
      observation({ id: "p2", value: "9,9", low: "1,0", high: "8,0", text: "1,0 - 8,0", at: "2026-08-10T12:00:00.000Z" }),
    ],
    null,
  );
  assert.ok(series);
  const model = historyChartModel(series, "3m", now);
  assert.equal(model.empty, null);
  assert.equal(model.points.length, 2);
  const [first, second] = model.points;
  assert.ok(first && second);
  assert.ok(first.x < second.x, "time flows left to right");
  assert.ok(first.y > second.y, "a larger value sits higher (smaller y)");
  assert.equal(first.status, "within");
  assert.equal(second.status, "above");
  assert.equal(second.documentId, "d");
  assert.equal(model.band.length, 2, "two printed ranges → two stepped segments");
  const [b1, b2] = model.band;
  assert.ok(b1 && b2);
  assert.ok(b1.x2 <= b2.x1 + 0.001, "segments do not overlap");
  assert.notEqual(b1.yTop, b2.yTop, "the step is visible");
  assert.ok(model.ticks.length >= 2);
  assert.ok(model.yMaxLabel.includes("9"), "the y extent covers the largest value");
});

test("a series with no numeric point in the period is empty and says so", () => {
  const [series] = buildDossierSeries(
    [observation({ id: "old", value: "2,0", at: "2024-01-10T08:00:00.000Z" })],
    null,
  );
  assert.ok(series);
  const model = historyChartModel(series, "3m", now);
  assert.equal(model.empty, "no_numeric");
  assert.deepEqual(model.points, []);
});

test("non-numeric values are left to the table; the chart keeps only numbers", () => {
  const [series] = buildDossierSeries(
    [
      observation({ id: "n1", value: "< 0,1", at: "2026-08-01T08:00:00.000Z" }),
      observation({ id: "n2", value: "2,2", at: "2026-08-10T08:00:00.000Z" }),
    ],
    null,
  );
  assert.ok(series);
  const model = historyChartModel(series, "all", now);
  assert.equal(model.points.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @veylta/web exec tsx --test app/history-chart.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/web/app/history-chart.ts
import type { PointStatus } from "@veylta/contracts";
import type { DossierSeries, SeriesPoint } from "./dossier";
import { formatSampleMoment } from "./format-moment";
import { type HistoryPeriod, periodStart } from "./history-summary";

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
  readonly status: PointStatus;
  readonly observationId: string;
  readonly documentId: string;
  readonly printed: string;
  readonly at: string;
  readonly laboratory: string | null;
  readonly rangeText: string | null;
}

/** One run of identical printed bounds; the band steps at the first point that prints new ones. */
export interface BandSegment {
  readonly x1: number;
  readonly x2: number;
  readonly yTop: number;
  readonly yBottom: number;
}

export interface AxisTick {
  readonly x: number;
  readonly label: string;
}

export interface HistoryChartModel {
  readonly points: readonly ChartPoint[];
  readonly band: readonly BandSegment[];
  readonly ticks: readonly AxisTick[];
  readonly yMinLabel: string;
  readonly yMaxLabel: string;
  readonly empty: "no_numeric" | null;
}

const PAD = 8; // percent of headroom above and below the data

/**
 * The chart as numbers only: x is the period's time axis, y is the value axis inverted for SVG,
 * both in percent of the drawing box. The reference band is stepped — each point's own printed
 * bounds hold until the next point prints different ones; a missing bound clamps to the edge.
 */
export function historyChartModel(
  series: DossierSeries,
  period: HistoryPeriod,
  now: Date,
): HistoryChartModel {
  const start = periodStart(period, now);
  const visible = series.points.filter(
    (point) => point.value !== null && (start === null || point.at >= start),
  );
  if (visible.length === 0) {
    return { points: [], band: [], ticks: [], yMinLabel: "", yMaxLabel: "", empty: "no_numeric" };
  }
  const firstAt = new Date(visible[0]?.at ?? now.toISOString()).getTime();
  const left = start === null ? firstAt : new Date(start).getTime();
  const right = now.getTime();
  const spanX = Math.max(right - left, 1);
  const xOf = (at: string) => ((new Date(at).getTime() - left) / spanX) * 100;

  const values = visible.map((point) => point.value ?? 0);
  const bounds = visible.flatMap((point) => [point.low, point.high]).filter((v): v is number => v !== null);
  const domain = [...values, ...bounds];
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const spanY = max - min || 1;
  const yOf = (value: number) => {
    const normalized = ((value - min) / spanY) * (100 - PAD * 2) + PAD;
    return 100 - normalized;
  };

  const points: ChartPoint[] = visible.map((point) => ({
    x: xOf(point.at),
    y: yOf(point.value ?? 0),
    status: point.status,
    observationId: point.observationId,
    documentId: point.documentId,
    printed: point.printed,
    at: point.at,
    laboratory: point.laboratory,
    rangeText: point.rangeText,
  }));

  const band: BandSegment[] = [];
  for (let index = 0; index < visible.length; index += 1) {
    const point = visible[index];
    if (point === undefined || (point.low === null && point.high === null)) continue;
    const x1 = points[index]?.x ?? 0;
    const next = points[index + 1]?.x;
    const x2 = next ?? 100;
    const yTop = point.high === null ? 0 : yOf(point.high);
    const yBottom = point.low === null ? 100 : yOf(point.low);
    const previous = band[band.length - 1];
    if (previous !== undefined && previous.yTop === yTop && previous.yBottom === yBottom) {
      band[band.length - 1] = { ...previous, x2 };
    } else {
      band.push({ x1, x2, yTop, yBottom });
    }
  }

  const tickCount = Math.min(4, Math.max(2, points.length));
  const ticks: AxisTick[] = Array.from({ length: tickCount }, (_, index) => {
    const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
    const at = new Date(left + ratio * spanX).toISOString();
    return { x: ratio * 100, label: formatSampleMoment(at.slice(0, 10)) };
  });

  return {
    points,
    band,
    ticks,
    yMinLabel: String(min),
    yMaxLabel: String(max),
    empty: null,
  };
}
```

(`SeriesPoint` carries `laboratory`? Check `dossier.ts` — the survey lists `SeriesPoint` WITHOUT `laboratory`: `{observationId, at, printed, value, status, rangeText, low, high, lowText, highText, documentId}`. If `laboratory` is absent, add it in `dossier.ts`'s point mapper from `item.laboratory` (one line, one fixture assertion in `dossier.test.ts`) — the chart's focus copy needs it; do that in this task and note it.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @veylta/web exec tsx --test app/history-chart.test.ts app/dossier.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write apps/web/app
git add apps/web/app
git commit -m "feat(web): the history chart's geometry — a stepped printed band, status points, the period axis

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: the confirmed-values row moves out; the data hook

**Files:**
- Create: `apps/web/app/observation-dates.ts`, `apps/web/app/observation-dates.test.ts`
- Create: `apps/web/app/components/observation-history-row.tsx`
- Create: `apps/web/app/use-history-data.ts`
- Modify: `apps/web/app/components/veylta-app.tsx` (delete the moved code, import the row where `ObservationHistoryPanel` still uses it — this task keeps the old panel working; the swap is Task 4)

**Interfaces:**
- Produces: `observation-dates.ts` — `ObservationDate { label: string; value: string }`, `timelineDate(item): ObservationDate` («Дата биоматериала» / «Дата результата» / «Дата загрузки» pick, as in `veylta-app.tsx:4411–4436` today), `knownObservationDates(item): readonly ObservationDate[]`, `observationSourceHref(item): string` (from ≈4444); `observation-history-row.tsx` — `ObservationHistoryRow({ item })` (the `<tr>` with the details/provenance, byte-moved from ≈4623–4735); `use-history-data.ts` — `useHistoryData({ familyId, profileId }): { state: HistoryDataState; reload(): void }` with `HistoryDataState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: readonly ObservationHistoryItem[]; sex: "female" | "male" | null; truncated: boolean }` — the dossier-panel loading pattern: `historyPageLimit = 100`, `historyPages = 8`, the observations pages sequential until `nextCursor === null` or the cap (then `truncated: true`), the medical profile in parallel for `passportOf(...).sex`, one `AbortController`, both failures → `{kind:"error"}`.

- [ ] **Step 1: Failing test for the date helpers**

```ts
// apps/web/app/observation-dates.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { observation } from "./dossier.fixture";
import { knownObservationDates, timelineDate } from "./observation-dates";

test("the timeline date prefers the sample, then the result, then the upload — with its label", () => {
  const item = observation({ id: "d1" });
  assert.equal(timelineDate(item).label, "Дата биоматериала");
  const noSample = { ...item, dates: { ...item.dates, sampledAt: null } };
  assert.equal(timelineDate(noSample).label, "Дата результата");
  const uploadOnly = { ...item, dates: { sampledAt: null, resultedAt: null, uploadedAt: item.dates.uploadedAt } };
  assert.equal(timelineDate(uploadOnly).label, "Дата загрузки");
  assert.equal(knownObservationDates(item).length, 3);
});
```

(Adjust to the fixture's actual `dates` shape; the helper bodies are MOVES from `veylta-app.tsx:4411–4436` — the test pins the pick order the old code implements; read it first and mirror exactly.)

- [ ] **Step 2: RED, then move**

Move the three helpers into `app/observation-dates.ts` (bodies unchanged), the row component into `components/observation-history-row.tsx` (`"use client"`, imports from `../observation-dates`, `../reference-range-copy`, `../format-moment`, `../api-client`), and have `veylta-app.tsx` import them (its `ObservationHistoryPanel` keeps rendering `<ObservationHistoryRow …/>` unchanged this task). Delete the moved code from `veylta-app.tsx`.

- [ ] **Step 3: The hook**

```ts
// apps/web/app/use-history-data.ts
"use client";

import type { MedicalProfileResponse, ObservationHistoryResponse } from "@veylta/contracts";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api-client";
import { medicalProfilePath } from "./components/medical-profile-controls";
import { passportOf } from "./dossier-passport";
import { profileApiPath } from "./paths";

type ObservationHistoryItem = ObservationHistoryResponse["items"][number];

export type HistoryDataState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      items: readonly ObservationHistoryItem[];
      sex: "female" | "male" | null;
      truncated: boolean;
    };

/** Bounded like the dossier: the newest pages of confirmed values; a household record fits. */
const historyPageLimit = 100;
const historyPages = 8;

/** The full confirmed history plus the passport's sex — everything the trends read. */
export function useHistoryData(input: { familyId: string; profileId: string }) {
  const [state, setState] = useState<HistoryDataState>({ kind: "loading" });
  const { familyId, profileId } = input;

  const load = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const base = `${profileApiPath(familyId, profileId)}/observations`;
        const profileRequest = apiRequest<MedicalProfileResponse>(
          medicalProfilePath(familyId, profileId),
          { signal },
        );
        const items: ObservationHistoryItem[] = [];
        let cursor: string | null = null;
        let truncated = false;
        for (let page = 0; page < historyPages; page += 1) {
          const query = cursor === null ? `?limit=${historyPageLimit}` : `?limit=${historyPageLimit}&cursor=${encodeURIComponent(cursor)}`;
          const response: ObservationHistoryResponse = await apiRequest<ObservationHistoryResponse>(
            `${base}${query}`,
            { signal },
          );
          items.push(...response.items);
          cursor = response.nextCursor;
          if (cursor === null) break;
          if (page === historyPages - 1) truncated = true;
        }
        const profile = await profileRequest;
        if (signal.aborted) return;
        const passport = passportOf(profile.entries, new Date());
        setState({ kind: "ready", items, sex: passport.sex ?? null, truncated });
      } catch {
        if (!signal.aborted) setState({ kind: "error" });
      }
    },
    [familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { state, reload: () => void load(new AbortController().signal) };
}
```

(Check the real shapes first: `dossier-panel.tsx` is the template — the medical-profile path helper (`medicalProfilePath`?), the response's `entries` field, and `passportOf`'s signature and its `sex` field; mirror what the panel does, including its error copy decision. If `passportOf` needs `new Date()` injected, keep it — the sex does not depend on the clock.)

- [ ] **Step 4: Verify**

Run: `pnpm exec biome check --write apps/web/app && pnpm --filter @veylta/web typecheck && pnpm --filter @veylta/web test && pnpm lint`
Expected: green; `veylta-app.tsx` shrank by the moved lines (report the count); no behaviour change (the history tab still renders the OLD panels this task).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app
git commit -m "refactor(web): the confirmed-values row and its date helpers leave the shell; the history data hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: the history workspace — summary, rail, chart, table; `veylta-app.tsx` swaps

**Files:**
- Create: `apps/web/app/components/history-workspace.tsx`, `apps/web/app/components/history-summary.tsx`, `apps/web/app/components/history-rail.tsx`, `apps/web/app/components/history-chart.tsx`
- Modify: `apps/web/app/components/veylta-app.tsx` (the history tab renders `<HistoryWorkspace/>`; `ObservationHistoryPanel`, `IndicatorCatalogPanel`, `IndicatorSeriesPanel`, `IndicatorSeriesChart`, `indicatorChartPoints`, their states/error copies/`differenceCopy`/`observationHistoryRequestPath`/`appendDistinctObservations` are deleted — `DocumentIndicatorHistory` (≈6761) and `buildIndicatorHistoryPath` STAY; check what they import and keep exactly that), `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Tasks 1–3 modules; `buildDossierSeries`, `seriesKeyOf`, `DossierSeries` (`../dossier`); `dossierAreaLabel` (`../dossier-areas`); `DossierSparkline` (`./dossier-sparkline`); `DeltaChip` (`./dossier-gauge`); `historyPath`, `documentPath` (`../paths`); `useProfileHandle` (`../profile-route`); `useRouter` (`next/navigation`).
- Produces: `HistoryWorkspace({ familyId, profileId, requestedCanonicalCode })`.

- [ ] **Step 1: The components**

`history-workspace.tsx` (the conductor):
- `useHistoryData`; on `ready`: `series = useMemo(() => buildDossierSeries(items, sex), …)`.
- Period state `useState<HistoryPeriod>("6m")` (the middle default; «Всё» one click away).
- Selection: `useState<string | null>(null)`; the effective key = the explicit selection ?? (requestedCanonicalCode → the first series whose `code === requestedCanonicalCode`) ?? `defaultSelectionKey(series)`. An effect syncs when `requestedCanonicalCode` changes (a `?code=` arrival re-selects). On a rail/chip click: set the state AND, when the clicked series has a non-null `code`, `router.replace(historyPath(handle, code), { scroll: false })` so the URL stays shareable; a null-coded series selects locally only.
- Unit chips: the series sharing the selected series' `code` (when >1) rendered above the chart as buttons («мМЕ/л», «нг/мл»), `aria-pressed`.
- Layout: `.history-cabinet` (grid `296px minmax(0,1fr)`, the dossier's `.dossier-cabinet` pattern) — left the rail, right: summary on top? NO — per the spec the summary is the page's opening section ABOVE the two columns: `<HistorySummaryPanel/>` full-width first, then the cabinet (rail | chart+table).
- The table: `<section id="observation-history" aria-labelledby="observation-history-title">` with `<h2 id="observation-history-title">История подтверждённых значений</h2>` (the OLD heading — `dashboard-redesign.spec.ts` pins the region name), the intro line as today, and a `<table>` of `ObservationHistoryRow` over `items.filter((item) => seriesKeyOf(item) === effectiveKey)` newest-first (they arrive newest-first from the API — keep that order). Column heads as today («Показатель» / «Значение как подтверждено» / «Дата» / «Источник»). When `truncated`: one line «Показаны последние 800 подтверждённых значений.»
- Loading: «Загружаем подтверждённые значения и их источники…»; error: the dossier-panel's copy pattern + «Обновить» button calling `reload`.
- Empty record (no series): one block «Пока нет подтверждённых значений. Подтвердите значения на странице документа — здесь появится динамика.»

`history-summary.tsx`:
- `<section className="history-summary" aria-labelledby="history-summary-title">`, `<h2 id="history-summary-title">Что изменилось</h2>`.
- The period switch: a `role="group"` of buttons with `aria-pressed`, labels from `historyPeriodLabel`.
- Four count blocks in `HISTORY_BUCKETS` order: the count (a number, `aria-hidden` decoration none), `historyBucketLabel[kind]`, and under each the chips (`<button>` per series: `series.name`, click → `onSelect(series)`); a bucket with 0 series renders the count only (no empty chip list). One line under the heading: «{measuredCount} показателей с измерениями за период» (decline with `pluralForm`).

`history-rail.tsx`:
- `<nav className="history-rail" aria-label="Показатели">` with the filter on top: `<section id="indicator-catalog">` wrapping `<label>… <input placeholder="Найти показатель" …/></label>` (the anchor target), filtering by `series.name`/`series.code` case-folded substring.
- Groups in `ANALYTE_AREAS` order (skip empty), heading `dossierAreaLabel[area]`; each row a `<button aria-pressed={selected}>`: the name, `<DossierSparkline points={series.points.map(p => ({id: p.observationId, value: p.value}))} band={{low: latest.low, high: latest.high}} tone={…} label={`${series.name}: ${series.points.length} значений во времени`}/>`, the latest printed + unit, `<DeltaChip delta={series.delta}/>`.
- Mobile (≤1100px per the spec): the rail collapses into a labelled `<select>` above the chart — render BOTH (the nav hidden by CSS on small screens, the select `.history-rail__select` hidden on large), options grouped by `<optgroup label={area}>`, value = series key. One source of truth: both call the same `onSelect`.

`history-chart.tsx`:
- `historyChartModel(series, period, now)` with `now = new Date()` memoised per render of the selection/period (a comment: the model is pure; the clock enters once here).
- `<figure className="history-chart">`: an `<svg viewBox="0 0 100 56" preserveAspectRatio="none" role="img" aria-label={`${series.name}: значения за период против референса лаборатории`}>` — band segments as `<rect class="history-chart__band">`, a `<polyline class="history-chart__line">` through the points, each point an `<a href={documentPath(handle, point.documentId)} class={`history-chart__point is-${point.status}`} aria-label={`${point.printed} ${series.unit} · ${formatSampleMoment(point.at.slice(0,10))}${point.laboratory ? ` · ${point.laboratory}` : ""}`}>` wrapping a `<circle>` + `<title>` (the same text — native hover); x-axis ticks as `<text>` under the box (outside the svg is fine: a flex row of tick labels under the figure keeps font control — choose one and keep the labels ≥12px per DESIGN.md).
- Status legend under the chart: three labelled dots («в референсе», «вне референса», «без референса») — explicit labels beside colours (DESIGN.md L55).
- `model.empty === "no_numeric"` → «В выбранном периоде нет числовых значений. Таблица ниже показывает всё, что подтверждено.»
- `<figcaption>`: «Точки — подтверждённые значения; полоса — референс из документа той же лаборатории. Точные значения и источники — в таблице ниже.»

CSS (`globals.css`, new classes `history-*` only; tokens/OKLCH literals in the dossier's palette): `.history-summary` (canvas surface, 16px radius, the four counts as a `repeat(auto-fit, minmax(180px, 1fr))` grid — counts as text, not hero-metric cards), `.history-summary__chip` (the `.dossier-rail__item`-like pill), `.history-cabinet` (the dossier grid + ≤1100px collapse), `.history-rail` (the `.dossier-rail` pattern; ≤1100px `display:none`, `.history-rail__select` shown), `.history-chart` (band fill `oklch(0.6 0.12 160 / 14%)`, line `var(--color-primary)` width 1.6 `vector-effect: non-scaling-stroke`, points: `.is-within` fill `oklch(0.72 0.12 160)`, `.is-above`/`.is-below`/`.is-flagged` fill `oklch(0.6 0.15 60)`, `.is-unknown` fill `var(--color-surface-strong)` stroke `var(--color-muted)`; `:focus-visible` ring via `outline` on the `<a>`), transitions 160ms ease-out with the `prefers-reduced-motion: reduce` override.

`veylta-app.tsx`: the history tabpanel body becomes
```tsx
<HistoryWorkspace
  key={`history:${family.id}:${profile.id}`}
  familyId={family.id}
  profileId={profile.id}
  requestedCanonicalCode={requestedCanonicalCode}
/>
```
Delete the four old components and their satellites (Biome's unused warnings guide; `DocumentIndicatorHistory` + `buildIndicatorHistoryPath` + whatever only they use STAY — `document-experience.test.ts` imports `buildIndicatorHistoryPath` from `./components/veylta-app` and must keep passing).

- [ ] **Step 2: Verify**

Run: `pnpm exec biome check --write apps/web/app && pnpm --filter @veylta/web typecheck && pnpm --filter @veylta/web test && pnpm lint && pnpm --filter @veylta/web build`
Expected: green; `veylta-app.tsx` well under 6831 (expect ≈ −700; report); every new component ≤ 250 lines (split `history-chart.tsx` → `history-chart-point.tsx` if needed).

Then the visual smoke (no e2e edits): `pnpm build && pnpm test:e2e e2e/dashboard-redesign.spec.ts` (it pins the region name «История подтверждённых значений» — must pass); `pnpm test:e2e e2e/observation-history.spec.ts` is EXPECTED to fail on the old dynamics assertions (Task 5 rewrites) — confirm the failures are assertion mismatches, not crashes. A throwaway screenshot spec in the scratchpad (never committed): register, upload, confirm both values, open `/…/history`, screenshot to the scratchpad; attach the path in the report.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): the history page — «что изменилось», the indicator rail, the chart against the printed band

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: e2e — the history journey; the old spec follows the new page

**Files:**
- Modify: `e2e/observation-history.spec.ts` (rewrite the dynamics test; keep the sources test's essence), any other spec the grep names
- Create: none (the scenario extends `observation-history.spec.ts` — keep it ≤ its baseline if listed; it is 149 lines today, not in the baseline, cap 250)

- [ ] **Step 1: Rewrite**

Test 1 (sources — keep, retarget): register → upload → confirm A / reject B → «История» → the region «История подтверждённых значений» shows 1 row with «7.0 synthetic-unit» and no «АНАЛИТ B»; the details still show «Фрагмент из исходника» and «Открыть исходник» downloads (the row component moved unchanged — the assertions stay).

Test 2 (the journey, replaces the dynamics test):
```ts
test("the summary counts the record, the rail selects, the chart binds each point to its source", async ({ page }) => {
  await registerDemoFamily(page);
  // Document 1: both values confirmed as printed (7.0 — inside 5.0–8.0).
  // Document 2: analyte A corrected to 9.9 — outside; the series moves out.
  // (openReview + confirmResult/correctResult as in the old dynamics test.)
  …
  await page.getByRole("tab", { name: "История", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);

  const summary = page.getByRole("region", { name: "Что изменилось" });
  await summary.getByRole("button", { name: "Всё" }).click();
  await expect(summary.getByText("Вышли за референс")).toBeVisible();
  // Counts only under «Всё» — the fixture's dates are pinned, a bounded period would rot.
  await expect(summary.getByRole("button", { name: /Синтетический аналит A/ })).toBeVisible();

  await summary.getByRole("button", { name: /Синтетический аналит A/ }).click();
  const chart = page.getByRole("img", { name: /Синтетический аналит A: значения за период/ });
  await expect(chart).toBeVisible();
  await expect(page.locator(".history-chart__point.is-above")).toHaveCount(1);
  await expect(page.locator(".history-chart__point.is-within")).toHaveCount(1);

  // A point opens its source document.
  await page.locator(".history-chart__point.is-above a, a.history-chart__point.is-above").first().click();
  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}$/);
  await page.goBack();

  // The table below is the indicator's values with sources.
  const table = page.getByRole("region", { name: "История подтверждённых значений" });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.getByRole("link", { name: "Открыть исходник" }).first()).toBeVisible();

  // The rail's filter narrows; ?code= selects.
  await page.getByPlaceholder("Найти показатель").fill("нет такого");
  await expect(page.locator(".history-rail li")).toHaveCount(0);
  await page.goto(`${page.url().replace(/\/history.*/, "")}/history?code=synthetic-analyte-a`);
  await expect(page.getByRole("img", { name: /Синтетический аналит A/ })).toBeVisible();

  // The period switch re-renders without breaking (no count assertions off «Всё»).
  await summary.getByRole("button", { name: "3 мес" }).click();
  await expect(summary.getByRole("button", { name: "3 мес" })).toHaveAttribute("aria-pressed", "true");
});
```
(Adapt selectors to the real markup — the class names and roles Task 4 defines; the point-click locator to however the `<a>` wraps the circle. Assert nothing period-dependent outside «Всё». If `document-review.spec.ts`'s «Открыть всю историю» flow asserts old copy after landing, retarget it: it lands on `?code=…` and must see the chart img for that analyte + the table region.)

Sweep: `grep -n "Подтверждённая динамика\|Расположение подтверждённых\|Показать следующие значения\|indicator-catalog\|Найти показатель" e2e/*.spec.ts` — retarget every hit (the «Подтверждённая динамика» region and the old chart img name are gone; `#indicator-catalog` now anchors the rail's filter — `dashboard-tools`' «Найти показатель» link still lands on it).

- [ ] **Step 2: Run the whole suite**

Run: `pnpm build && pnpm test:e2e`
Expected: all pass (≈48; 2 README screenshot specs skipped). Read failures before touching an assertion; never weaken one.

- [ ] **Step 3: Commit**

```bash
pnpm exec biome check --write e2e
git add e2e
git commit -m "test(e2e): the history journey — the summary, the rail, the chart, the sources

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: docs, README media, full check

**Files:**
- Modify: `CLAUDE.md` (a «History: trends and „что изменилось"» paragraph after the documents one), `docs/status.md` (item 30), `docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md` (Part 4 status line + execution decisions), `README.md` (if it describes the history tab), `docs/media/*.png` (regenerated — the deferred decision from Parts 1–3)

- [ ] **Step 1: Docs**

CLAUDE.md paragraph (adjust names to the final tree):

```md
**History: trends and «что изменилось».** The history tab reads the record it already has: one
paged load of all confirmed observations plus the passport's sex (`app/use-history-data.ts`, the
dossier's bounded pattern), `buildDossierSeries` over it, and pure rules on top —
`app/history-summary.ts` (periods 3 мес/6 мес/Год/Всё by UTC month arithmetic; four buckets by
the dossier's status rule: вышли за референс / вернулись / без изменений / впервые измерены;
`defaultSelectionKey` — the first outside series, else the first) and `app/history-chart.ts`
(percent geometry: the printed reference band stepped per value, status points, the period's time
axis). Components: `history-workspace.tsx` (selection = `?code=` → `requestedCanonicalCode`, else
the default; a click writes the URL back for coded series) → `history-summary.tsx` (period switch
+ counts + chips), `history-rail.tsx` (areas in `ANALYTE_AREAS` order, sparkline + delta, the
filter anchored as `#indicator-catalog`; a select on narrow screens), `history-chart.tsx` (SVG;
every point links to its source document; explicit status labels), and the confirmed-values table
(`components/observation-history-row.tsx`, `app/observation-dates.ts`) under the stable anchor
`#observation-history`. Units are never converted: one code with two printed units is two series
chosen by a chip. `DocumentIndicatorHistory` on the document page still uses
`GET …/indicators/:code`.
```

`docs/status.md` item 30: `30. read the history as trends: «что изменилось» over a period, an indicator rail with sparklines, the chart against the printed reference band, every point linked to its source.` Spec: «Status: delivered on <date>» + the execution decisions (bucket rule baselines; counts only under «Всё» in e2e; select on mobile per the spec).

- [ ] **Step 2: README media**

Run: `README_SCREENSHOTS=1 pnpm test:e2e e2e/readme-screenshots.spec.ts` — this time COMMIT the regenerated `docs/media/*.png` (the standing deferral ends with Part 4). Eyeball each PNG (Read them) before committing: no real data, the new pages look right.

- [ ] **Step 3: Full check**

Run as one background chain with `EXIT_CODE` logging: `pnpm license:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e` — green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md docs/status.md docs/superpowers/specs/2026-08-18-shell-routes-documents-history-design.md docs/media
git commit -m "docs: the history trends page; refreshed screenshots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

The controller pushes `main`, watches CI to success, runs the ratchet hygiene commit (`pnpm lint:lines --write`) if files shrank, and closes the plan.
