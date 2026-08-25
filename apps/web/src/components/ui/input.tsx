import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

// Glass field: flat --glass fill + hairline at --r-item (no backdrop-filter, so
// it never nests blur inside a .glass panel), brand focus ring visible over glass.
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'glass-field flex h-10 w-full px-3 py-2 text-sm outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
