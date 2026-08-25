import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Shared 34px glass icon button (--r-icon): flat --glass fill + hairline, no
// backdrop-filter (never nests blur). Used by the top-bar bell / help / menu.
// Callers MUST pass an aria-label (icon-only control).
export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(
          'glass-icon-btn relative outline-none focus-ring-brand',
          className,
        )}
        {...props}
      />
    );
  },
);
IconButton.displayName = 'IconButton';

export { IconButton };
