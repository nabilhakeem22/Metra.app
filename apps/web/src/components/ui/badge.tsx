import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Glass UI chip/badge: pill (--r-pill), 11px. The neutral chip uses --track; the
// brand "eyebrow" uses the brand tint/ink; semantic states (done/warn/danger)
// map to the semantic tokens, NEVER the brand accent.
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium',
  {
    variants: {
      variant: {
        default: 'bg-[color:var(--track)] text-[color:var(--text-muted)]',
        brand:
          'border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] font-semibold text-[color:var(--brand-ink)]',
        success:
          'bg-[color:var(--success-tint)] text-[color:var(--success)]',
        warn: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
        danger: 'bg-[color:var(--danger-tint)] text-[color:var(--danger)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Show a small leading status dot in the current text colour. */
  dot?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, dot = false, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-current"
          aria-hidden
        />
      )}
      {children}
    </span>
  ),
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
