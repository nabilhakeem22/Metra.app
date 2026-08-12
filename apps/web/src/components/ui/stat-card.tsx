import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  /** Preformatted display string, or null/undefined when there is no data yet. */
  value?: string | null;
  icon?: ReactNode;
  variant?: 'plain' | 'gradient';
  accent?: 'blue' | 'amber';
  hint?: string;
  /** Fallback shown when value is nullish — e.g. '—' for money, '0' for counts. */
  empty?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  variant = 'plain',
  accent: _accent = 'blue',
  hint,
  empty = '—',
  className,
}: StatCardProps) {
  const isGradient = variant === 'gradient';
  const display = value == null || value === '' ? empty : value;

  // Snap Line: KPI blocks collapse to a solid CARBON fill (gypsum text, 16.9:1) —
  // chalk stays rare (the datum + one primary action only), not on every stat.
  const strong = 'bg-foreground text-background';

  return (
    <Card
      className={cn(
        'p-5',
        isGradient ? cn('border-transparent shadow-card', strong) : '',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            'text-sm font-medium',
            isGradient ? 'text-current/90' : 'text-muted-foreground',
          )}
        >
          {label}
        </p>
        {icon && (
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              isGradient
                ? 'bg-white/15 text-current'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {icon}
          </div>
        )}
      </div>

      <p
        className={cn(
          'tabular mt-3 text-3xl font-bold tracking-tight',
          isGradient ? 'text-current' : 'text-foreground',
        )}
      >
        {display}
      </p>

      {hint && (
        <p
          className={cn(
            'mt-1 text-xs',
            isGradient ? 'text-current/80' : 'text-muted-foreground',
          )}
        >
          {hint}
        </p>
      )}
    </Card>
  );
}
