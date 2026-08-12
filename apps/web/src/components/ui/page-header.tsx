import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Breadcrumb slot (rendered above the title). */
  breadcrumb?: ReactNode;
  /** Primary-action slot (rendered at the inline-end). */
  action?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        // hairline rule under the header — a quiet echo of the trace baseline
        'flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="space-y-1">
        {breadcrumb && (
          <div className="text-sm text-muted-foreground">{breadcrumb}</div>
        )}
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {/* Carbon tick — chalk stays reserved for the active nav + primary action. */}
          <span aria-hidden className="h-5 w-[3px] bg-foreground" />
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
