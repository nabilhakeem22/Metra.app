import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Glass UI tag: pill (--r-pill), caption size. A LABEL, not a status: the
// neutral tag uses --track, the brand "eyebrow" the brand tint/ink. A status
// (done, waiting, stalled ...) is a StatusChip, never a Badge.
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-caption font-medium',
  {
    variants: {
      variant: {
        default: 'bg-[color:var(--track)] text-[color:var(--text-muted)]',
        brand:
          'border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] font-semibold text-[color:var(--brand-ink)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { Badge };
