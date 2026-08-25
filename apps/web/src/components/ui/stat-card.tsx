import type { ReactNode } from 'react';
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
  accent = 'blue',
  hint,
  empty = '—',
  className,
}: StatCardProps) {
  const isGradient = variant === 'gradient';
  const display = value == null || value === '' ? empty : value;

  // Solid strong fills (teal / copper-strong) keep on-color text >= 4.5:1 —
  // an opacity fade toward the light card would break contrast.
  const strong =
    accent === 'amber'
      ? 'bg-brand-strong text-brand-foreground'
      : 'bg-primary text-primary-foreground';

  // FLAT panel (opaque bg-card, no backdrop-filter): KPI grids repeat StatCard,
  // so keeping it flat protects the ≤6 blurred-surfaces-per-screen budget. Only
  // Card itself is a blurred .glass panel.
  return (
    <div
      className={cn(
        'rounded-panel border border-[color:var(--glass-hairline)] bg-card p-5 shadow-glass',
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
              'flex size-10 shrink-0 items-center justify-center rounded-item',
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
          'tabular mt-3 text-3xl font-bold',
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
    </div>
  );
}
