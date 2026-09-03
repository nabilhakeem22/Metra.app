import { Card, CardContent } from '@/components/ui/card';

/** One month's column: the segments stack bottom-up in the order given. */
export interface ChartColumn {
  /** `YYYY-MM` — the caller supplies the display label separately, localized. */
  month: string;
  label: string;
  segments: Array<{ key: string; value: number }>;
}

/** A series: the segment key, its label, and the colour token that draws it. */
export interface ChartSeries {
  key: string;
  label: string;
  token: string;
}

/**
 * A stacked monthly bar chart with hover read-out.
 *
 * HTML/CSS BARS, NOT SVG. The first version drew rects in an SVG with
 * `preserveAspectRatio="none"`, which stretches any text placed inside it — so the
 * per-bar numbers had nowhere to live. Percentage-height divs solve that outright:
 * the tooltip is ordinary HTML, undistorted, and the whole thing stays responsive
 * without measuring anything.
 *
 * STILL ZERO JAVASCRIPT. The read-out is revealed by `group-hover`, so this remains
 * a server component. A tooltip is not worth shipping a client bundle for.
 *
 * ACCESSIBILITY: every column carries a visually-hidden sentence with its real
 * numbers, so a screen reader gets the DATA rather than the one summary line the SVG
 * version could offer. Touch devices have no hover, which is exactly why those
 * numbers are also in the accessible text rather than only in the tooltip.
 *
 * HONESTY: a month with no data still draws its (empty) column, because a chart that
 * skips quiet months misrepresents the trend. When every month is zero it says so in
 * words instead of drawing a flat line that looks like data.
 */
export function DashboardBarChart({
  title,
  summary,
  columns,
  series,
  emptyLabel,
  totalLabel,
}: {
  title: string;
  /** One sentence describing the chart, for the region label. */
  summary: string;
  columns: ChartColumn[];
  /** In stacking order, bottom first. */
  series: ChartSeries[];
  emptyLabel: string;
  /** Label for the total line in the hover read-out, e.g. "Total". */
  totalLabel: string;
}) {
  const totals = columns.map((c) =>
    c.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0),
  );
  const max = Math.max(...totals, 0);

  if (max === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          <ChartHeader title={title} series={series} />
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        </CardContent>
      </Card>
    );
  }

  const labelOf = (key: string) => series.find((s) => s.key === key)?.label ?? key;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <ChartHeader title={title} series={series} />

        {/* Headroom for the read-out lives on a WRAPPER, not on the sized row:
            `h-32` is border-box, so padding on the row itself would eat the bars'
            height and halve every column. Anchored above its column, the read-out
            lands in this space — never covering the bar it describes, never
            escaping the card. */}
        <div className="pt-[4.5rem]">
          <div className="flex h-32 items-end gap-2" role="group" aria-label={summary}>
          {columns.map((column, i) => {
            const total = totals[i];
            return (
              <div key={column.month} className="group relative flex h-full flex-1 flex-col justify-end">
                {/* Anchored above the column, into the headroom the row reserves —
                    so it neither covers the bar nor escapes the card. */}
                {/* Centred with flex rather than `left-1/2 -translate-x-1/2`: a
                    physical offset and an unflipped translate both point the wrong
                    way in RTL, which is Metra's primary direction. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-1 hidden justify-center group-hover:flex">
                  {/* `bg-card`, not `bg-[color:var(--card)]`: --card holds HSL
                      COMPONENTS for shadcn, so the raw var is not a valid colour and
                      the tooltip rendered transparent with the bar showing through. */}
                  <div className="whitespace-nowrap rounded-[var(--r-item)] border border-[color:var(--rule)] bg-card px-2 py-1.5 text-start shadow-md">
                  <p className="text-[11px] font-semibold">{column.label}</p>
                  {column.segments.map((segment) => (
                    <p
                      key={segment.key}
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    >
                      <span
                        className="size-2 rounded-[2px]"
                        style={{
                          background: `var(${series.find((s) => s.key === segment.key)?.token ?? '--rule'})`,
                        }}
                        aria-hidden
                      />
                      {labelOf(segment.key)}
                      <span className="ms-auto font-medium tabular-nums text-foreground" dir="ltr">
                        {segment.value}
                      </span>
                    </p>
                  ))}
                  <p className="mt-0.5 flex items-center gap-3 border-t border-[color:var(--rule)] pt-0.5 text-[11px] font-semibold">
                    {totalLabel}
                    <span className="ms-auto tabular-nums" dir="ltr">
                      {total}
                    </span>
                  </p>
                  </div>
                </div>

                {/* The column. `flex-col-reverse` stacks the first segment at the
                    bottom, matching the legend order. */}
                {/* `h-full` is load-bearing: the segment heights below are
                    PERCENTAGES, and a percentage height resolves against a definite
                    parent. Without it this container is content-sized, every segment
                    computes to zero, and the chart renders no bars at all. */}
                <div className="flex h-full w-full flex-col-reverse overflow-hidden rounded-[3px] transition-opacity group-hover:opacity-90">
                  {column.segments.map((segment) => {
                    const value = Math.max(0, segment.value);
                    if (value === 0) return null;
                    return (
                      <div
                        key={segment.key}
                        style={{
                          height: `${(value / max) * 100}%`,
                          background: `var(${series.find((s) => s.key === segment.key)?.token ?? '--rule'})`,
                        }}
                      />
                    );
                  })}
                  {/* An empty month still occupies its slot, as a hairline. */}
                  {total === 0 && (
                    <div className="h-px w-full bg-[color:var(--rule)]" aria-hidden />
                  )}
                </div>

                {/* The real numbers, for screen readers and for touch. */}
                <span className="sr-only">
                  {column.label}: {totalLabel} {total}
                  {column.segments
                    .filter((s) => s.value > 0)
                    .map((s) => `, ${labelOf(s.key)} ${s.value}`)
                    .join('')}
                </span>
              </div>
            );
          })}
          </div>
        </div>

        {/* NO `dir` on the row: the bars above flow in the AMBIENT direction, so
            forcing this to LTR put every label under the wrong bar in Arabic. Each
            label carries its own `dir` instead, which keeps the text itself
            correct without reversing the order. */}
        <div
          className="grid gap-2 text-center text-[10px] text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          aria-hidden
        >
          {columns.map((c) => (
            <span key={c.month} dir="auto">
              {c.label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Title plus the colour legend — shared by the populated and empty states. */
function ChartHeader({ title, series }: { title: string; series: ChartSeries[] }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="flex flex-wrap items-center gap-3">
        {series.map((s) => (
          <li
            key={s.key}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className="size-2.5 rounded-[2px]"
              style={{ background: `var(${s.token})` }}
              aria-hidden
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
