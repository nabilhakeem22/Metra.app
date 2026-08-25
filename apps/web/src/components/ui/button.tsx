import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Glass UI buttons: every button is a pill (--r-pill), 14px/600. The variant
// NAMES + API are unchanged (default/secondary/outline/ghost/destructive ×
// default/sm/lg/icon) so no `<Button variant=…>` / asChild call site breaks —
// only the looks are remapped onto the glass tokens.
//
// Blur note: the handoff calls for --glass-blur-sm on the secondary button, but
// buttons overwhelmingly sit INSIDE .glass panels; a backdrop-filter there
// nests blur (the perf fence + the Slice-2 shell convention forbid it). So the
// secondary/outline glass look is a FLAT fill (--glass-btn) + hairline, matching
// how the shell's org-switcher / icon buttons already avoid nested blur.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold outline-none focus-ring-brand transition-[background,border-color,box-shadow,transform,color] duration-[160ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none disabled:pointer-events-none',
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
        // Outline maps to the same secondary glass treatment (the style tile's
        // "Cancel" is a glass button, not a hard-bordered one).
        outline:
          'border border-[color:var(--glass-hairline)] bg-[color:var(--glass-btn)] text-[color:var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,.4)] hover:bg-[color:var(--glass-btn-hover)] disabled:opacity-60',
        // Ghost: no fill, label --brand-ink (not --brand, for contrast over glass).
        ghost:
          'text-[color:var(--brand-ink)] hover:bg-[color:var(--track)] disabled:opacity-60',
        // Destructive keeps a filled semantic look, theme-aware label.
        destructive:
          'bg-[color:var(--danger)] text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.25)] hover:opacity-90 disabled:opacity-60',
      },
      size: {
        default: 'px-[18px] py-[10px]',
        sm: 'px-[14px] py-[8px] text-[13px]',
        lg: 'px-[20px] py-[11px]', // page-CTA
        icon: 'size-10 p-0',
      },
    },
    compoundVariants: [
      // Ghost is tighter (10px 12px) than the filled pills.
      { variant: 'ghost', size: 'default', class: 'px-3' },
      { variant: 'ghost', size: 'lg', class: 'px-4' },
      { variant: 'ghost', size: 'sm', class: 'px-2.5' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
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

export { Button, buttonVariants };
