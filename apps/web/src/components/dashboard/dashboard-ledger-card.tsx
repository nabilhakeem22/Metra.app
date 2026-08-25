import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export interface LedgerRow {
  key: string;
  label: string;
  value: string;
}

export interface DashboardLedgerCardProps {
  title: string;
  statusLabel: string;
  rows: LedgerRow[];
  className?: string;
}

/**
 * Glass "Project ledger" panel: header row (17px title + neutral --track status
 * chip) over a --rule divider, then dotted rows. Every inner surface is a flat
 * --track/--rule fill — the Card's backdrop-filter is the only blur here, never
 * nested. Row values are Western tabular figures (money law), aligned inline-end.
 */
export function DashboardLedgerCard({
  title,
  statusLabel,
  rows,
  className,
}: DashboardLedgerCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{title}</CardTitle>
        <Badge>{statusLabel}</Badge>
      </CardHeader>
      <div>
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between border-b border-[color:var(--rule-soft)] px-5 py-[11px] last:border-b-0"
          >
            <span className="flex items-center gap-[9px] text-sm text-[color:var(--text-muted)]">
              <span
                aria-hidden
                className="size-[7px] shrink-0 rounded-full bg-brand/70"
              />
              {row.label}
            </span>
            <span className="tabular text-sm font-semibold text-[color:var(--text)]">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
