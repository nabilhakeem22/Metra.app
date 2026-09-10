import { Card, CardContent } from '@/components/ui/card';
import type { ChartSeries } from './dashboard-bar-chart';

/** One slice: which series it is, and how much of the whole it accounts for. */
export interface DonutSlice {
  key: string;
  value: number;
}

/**
 * A half-donut composition chart — the arc sweeps the top semicircle and the
 * total sits in the well beneath it.
 *
 * WHAT IT ANSWERS, AND WHAT IT GAVE UP. This replaces a stacked monthly bar
 * chart. A bar chart answered "how did this move month by month"; a donut answers
 * "what is the split". The time dimension is genuinely gone — that is the trade,
 * not an oversight. What the form buys back is that a share reads instantly: at a
 * glance you see two thirds active without comparing column heights.
 *
 * NO CHARTING LIBRARY. The reference for this shape was an ECharts option object,
 * but a half donut is two arcs and some trigonometry. Pulling in ECharts would
 * cost roughly a megabyte of client JavaScript and turn this into a client
 * component, when the whole dashboard currently ships ZERO JavaScript for its
 * charts. The hover read-out is `group-hover`, exactly as the bar chart does it.
 *
 * ACCESSIBILITY. Every slice is direct-labelled with its own value and percent
 * in ORDINARY VISIBLE TEXT below the ring, so identity is never carried by colour
 * alone — which is also the secondary encoding a categorical palette needs, and
 * what a touch device gets in place of hover. Nothing here depends on a tooltip.
 *
 * HONESTY. An all-zero period draws no ring and says so in words, rather than
 * rendering a full circle of nothing that looks like data.
 */
export function DashboardDonut({
  title,
  summary,
  slices,
  series,
  emptyLabel,
  totalLabel,
  rtl = false,
}: {
  title: string;
  /** One sentence describing the chart, for the region label. */
  summary: string;
  slices: DonutSlice[];
  /** In sweep order, from the reading edge. */
  series: ChartSeries[];
  emptyLabel: string;
  totalLabel: string;
  /** ar-EG reads right-to-left, so the arc starts from the other end. */
  rtl?: boolean;
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);

  if (total === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        </CardContent>
      </Card>
    );
  }

  // Geometry. The arc sweeps the TOP semicircle (180° → 360°), so the centre well
  // sits under it and holds the total without fighting the ring for space.
  const CX = 110;
  const CY = 104;
  const R_OUT = 96;
  const R_IN = 60;
  // A 2px surface gap between fills — adjacent slices must not touch, or two
  // similar hues read as one shape.
  const GAP_DEG = 1.6;

  const labelOf = (key: string) => series.find((s) => s.key === key)?.label ?? key;
  const tokenOf = (key: string) =>
    series.find((s) => s.key === key)?.token ?? '--rule';

  // In RTL the arc should begin at the reading edge, so the slice order reverses.
  // Sweep direction stays the same; only which end series[0] occupies changes.
  const ordered = rtl ? [...slices].reverse() : slices;

  let cursor = 180;
  const arcs = ordered
    .filter((s) => s.value > 0)
    .map((slice) => {
      const sweep = (Math.max(0, slice.value) / total) * 180;
      const from = cursor;
      const to = cursor + sweep;
      cursor = to;
      // Trim the gap from both ends, but never past the slice itself — a sliver
      // must still draw something rather than inverting into a negative arc.
      const trim = Math.min(GAP_DEG / 2, sweep / 2.5);
      return {
        key: slice.key,
        value: slice.value,
        d: donutArc(CX, CY, R_OUT, R_IN, from + trim, to - trim),
      };
    });

  const pct = (value: number) => Math.round((value / total) * 100);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <h3 className="text-sm font-semibold">{title}</h3>

        <div className="relative" role="group" aria-label={summary}>
          <svg
            viewBox={`0 0 ${CX * 2} ${CY + 14}`}
            className="block w-full"
            role="img"
            aria-label={summary}
          >
            {arcs.map((arc) => (
              <path
                key={arc.key}
                d={arc.d}
                fill={`var(${tokenOf(arc.key)})`}
                className="transition-opacity duration-150 hover:opacity-80"
              >
                <title>{`${labelOf(arc.key)}: ${arc.value} (${pct(arc.value)}%)`}</title>
              </path>
            ))}
          </svg>

          {/* The total, in the well the half-donut leaves open. Absolute rather
              than an SVG <text>: SVG text scales with the viewBox, so it would
              shrink on a narrow card while the surrounding UI stayed put. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[6%] flex flex-col items-center">
            <span
              className="font-mono text-[26px] font-bold leading-none tabular-nums text-[color:var(--text)]"
              dir="ltr"
            >
              {total}
            </span>
            <span className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
              {totalLabel}
            </span>
          </div>
        </div>

        {/* DIRECT LABELS. Four or fewer series get their numbers on the page, not
            only in a tooltip — which is what makes the palette legal without
            relying on hue alone, and what a touch device gets instead of hover. */}
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-x-3 gap-y-1.5 p-0">
          {series.map((s) => {
            const value = slices.find((x) => x.key === s.key)?.value ?? 0;
            return (
              <li key={s.key} className="flex items-baseline gap-1.5 text-[11.5px]">
                <span
                  className="size-2 shrink-0 translate-y-[-1px] rounded-[2px]"
                  style={{ background: `var(${s.token})` }}
                  aria-hidden
                />
                <span className="min-w-0 truncate text-[color:var(--text-muted)]">
                  {s.label}
                </span>
                <span
                  className="ms-auto font-semibold tabular-nums text-[color:var(--text)]"
                  dir="ltr"
                >
                  {value}
                </span>
                <span className="tabular-nums text-[color:var(--text-faint)]" dir="ltr">
                  {pct(value)}%
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * One donut segment as an SVG path.
 *
 * Angles are degrees on the screen convention: 180° is the left end of the
 * horizontal, 270° is straight up, 360° is the right end — so 180 → 360 sweeps
 * the top half. Everything here is pure trigonometry evaluated on the server; the
 * browser receives a `d` attribute and nothing else.
 */
function donutArc(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  from: number,
  to: number,
): string {
  const p = (r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const large = to - from > 180 ? 1 : 0;
  const [x1, y1] = p(rOuter, from);
  const [x2, y2] = p(rOuter, to);
  const [x3, y3] = p(rInner, to);
  const [x4, y4] = p(rInner, from);
  const f = (n: number) => n.toFixed(2);
  return [
    `M ${f(x1)} ${f(y1)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${f(x2)} ${f(y2)}`,
    `L ${f(x3)} ${f(y3)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${f(x4)} ${f(y4)}`,
    'Z',
  ].join(' ');
}
