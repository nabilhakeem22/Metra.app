import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

// The multi-line Input: the same flat glass field and brand focus ring. NO text
// size class: `.glass-field` sets `font-size: var(--field-fs)`, which is 14px
// with a mouse and 16px on touch, where anything smaller makes iOS zoom in.
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'glass-field min-h-20 w-full px-3 py-2 outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
