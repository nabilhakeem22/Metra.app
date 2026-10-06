import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Glass UI buttons: every button is a pill (--r-pill), body size, 600.
//
// THE HIERARCHY IS THE API. `variant` is REQUIRED, so every call site says what
// it is: `default` (filled) is the page's ONE primary action, at most one per
// viewport (a modal is its own viewport); `secondary` is every other action;
// `ghost` is tertiary and icon-only, and it is NEUTRAL (brand blue is reserved
// for the primary). `destructive` is ConfirmDialog's confirm button and nothing
// else: a destructive action lives in an overflow menu behind that confirm.
//
// Blur note: the handoff calls for --glass-blur-sm on the secondary button, but
// buttons overwhelmingly sit INSIDE .glass panels; a backdrop-filter there
// nests blur (the perf fence + the Slice-2 shell convention forbid it). So the
// secondary glass look is a FLAT fill (--glass-btn) + hairline, matching how
// the shell's org-switcher / icon buttons already avoid nested blur.
//
// On a coarse pointer every size is at least 44px tall (the icon size 44px
// square), so a finger never has to hit a desktop-sized target.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-body font-semibold outline-none focus-ring-brand transition-[background,border-color,box-shadow,transform,color] duration-[160ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none disabled:pointer-events-none',
  {
    variants: {
      variant: {
        // Primary: --brand-grad fill, label via --primary-foreground (white on
        // light / #0A0E16 on dark), brand glow + inner top light; hover lifts,
        // active settles with a halved shadow.
        default:
          'bg-[image:var(--brand-grad)] text-primary-foreground shadow-[var(--brand-glow),inset_0_1px_0_rgba(255,255,255,.4)] hover:-translate-y-px hover:shadow-[var(--brand-glow-lift),inset_0_1px_0_rgba(255,255,255,.4)] active:translate-y-0 active:shadow-[var(--brand-glow-press),inset_0_1px_0_rgba(255,255,255,.4)] disabled:opacity-60',
        // Secondary: flat glass fill + hairline, label --text; hover bumps fill.
        secondary:
          'border border-[color:var(--glass-hairline)] bg-[color:var(--glass-btn)] text-[color:var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,.4)] hover:bg-[color:var(--glass-btn-hover)] disabled:opacity-60',
        // Ghost: no fill, neutral muted label that darkens on hover.
        ghost:
          'text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)] disabled:opacity-60',
        // Destructive: ConfirmDialog's confirm only. Theme-aware label.
        destructive:
          'bg-[color:var(--danger)] text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.25)] hover:opacity-90 disabled:opacity-60',
      },
      size: {
        default: 'px-[18px] py-[10px] coarse:min-h-11',
        sm: 'px-[14px] py-[8px] text-small coarse:min-h-11',
        lg: 'px-[20px] py-[11px] coarse:min-h-11', // page-CTA
        icon: 'size-10 p-0 coarse:size-11',
      },
    },
    compoundVariants: [
      // Ghost is tighter (10px 12px) than the filled pills.
      { variant: 'ghost', size: 'default', class: 'px-3' },
      { variant: 'ghost', size: 'lg', class: 'px-4' },
      { variant: 'ghost', size: 'sm', class: 'px-2.5' },
    ],
    defaultVariants: {
      size: 'default',
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'variant'> {
  /** Required: the call site names its place in the hierarchy. */
  variant: ButtonVariant;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button };
