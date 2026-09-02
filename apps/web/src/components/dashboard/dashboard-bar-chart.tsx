import { Card, CardContent } from '@/components/ui/card';

/** One month's column: the segments stack bottom-up in the order given. */
export interface ChartColumn {
  /** `YYYY-MM` — the caller supplies the display label separately, localized. */
  month: string;
  label: string;
  segments: Array<{ key: string; value: number }>;
}

/**
 * A stacked monthly bar chart, hand-rolled in SVG.
 *
 * No charting library on purpose: this runs in a Cloudflare Worker, and recharts or
 * similar is a large dependency for two panels of a dozen bars. The existing `Gauge`
 * set the same precedent.
 *
 * Server component — it takes finished numbers and draws them, so it ships no
 * JavaScript at all.
 *
 * ACCESSIBILITY AND HONESTY:
 *  - the SVG carries `role="img"` and a caller-supplied summary, so it is not a
 *    silent picture to a screen reader;
 *  - a month with no data still draws its (empty) column, because a chart that
 *    skips quiet months lies about the shape of the trend;
 *  - when every month is zero the chart says so in words rather than drawing a flat
 *    line that looks like data.
 * Colours come from the `--chart-*` token family so both themes and RTL hold.
 */
export function DashboardBarChart({
  title,
  summary,
  columns,
  series,
  emptyLabel,
}: {
  title: string;
  /** One sentence describing the whole chart, for `aria-label`. */
  summary: string;
  columns: ChartColumn[];
  /** Segment key -> {label, colour token}, in stacking order. */
  series: Array<{ key: string; label: string; token: string }>;
  emptyLabel: string;
}) {
  const totals = columns.map((c) =>
    c.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0),
  );
  const max = Math.max(...totals, 0);
  const isEmpty = max === 0;

  // A fixed viewBox scaled by CSS: the chart is responsive without measuring.
  const width = Math.max(columns.length * 40, 40);
  const height = 120;
  const gap = 8;
  const barWidth = Math.max(columns.length > 0 ? width / columns.length - gap : 0, 4);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <ul className="flex flex-wrap items-center gap-3">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
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

        {isEmpty ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={summary}
              className="h-32 w-full"
            >
              {columns.map((column, i) => {
                let y = height;
                return (
                  <g key={column.month}>
                    {column.segments.map((segment) => {
                      const value = Math.max(0, segment.value);
                      if (value === 0) return null;
                      const h = (value / max) * (height - 4);
                      y -= h;
                      const token = series.find((s) => s.key === segment.key)?.token;
                      return (
                        <rect
                          key={segment.key}
                          x={i * (barWidth + gap)}
                          y={y}
                          width={barWidth}
                          height={h}
                          rx={2}
                          fill={`var(${token ?? '--rule'})`}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </svg>
            {/* Labels sit OUTSIDE the SVG so they never scale with preserveAspectRatio
                none, which would stretch the type. */}
            <div
              className="grid gap-2 text-center text-[10px] text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
              dir="ltr"
            >
              {columns.map((c) => (
                <span key={c.month}>{c.label}</span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
