import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  hint?: string;
  /** Primary CTA slot — the template P1 modules inherit. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-item bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-body text-muted-foreground">{description}</p>
        )}
      </div>
      {hint && (
        <span className="rounded-pill bg-muted px-3 py-1 text-caption font-medium text-muted-foreground">
          {hint}
        </span>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
