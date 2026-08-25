import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Gauge } from '@/components/ui/gauge';

export interface DashboardPortfolioCardProps {
  title: string;
  /** Portfolio completion (0–100). `null` → honest empty state, no arc. */
  value: number | null;
  emptyLabel: string;
  className?: string;
}

/**
 * Glass "Portfolio progress" panel: 17px title + the brand semicircle Gauge.
 * With no active projects the Gauge renders its track + the empty-state label
 * (never a broken/zero arc). The arc mirrors in RTL inside the Gauge primitive.
 */
export function DashboardPortfolioCard({
  title,
  value,
  emptyLabel,
  className,
}: DashboardPortfolioCardProps) {
  const isEmpty = value == null || value <= 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex justify-center pb-6 pt-2">
        <Gauge
          value={isEmpty ? null : value}
          empty={isEmpty}
          emptyLabel={emptyLabel}
          className="max-w-xs"
        />
      </CardContent>
    </Card>
  );
}
