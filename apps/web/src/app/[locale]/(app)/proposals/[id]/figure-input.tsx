'use client';

import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { figureOf } from './builder-model';

/**
 * A builder number box. It takes what the studio types (Arabic-Indic digits,
 * "1,000", a trailing dot) and, on blur, rewrites itself to the figure that will
 * be saved, in Latin digits (`figureOf`), so the box never shows a number
 * different from the one the preview and the save use. Anything it cannot read
 * ("1,5", letters) is left as typed for the save to point at.
 */
export function FigureInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Input
      {...props}
      dir="ltr"
      inputMode="decimal"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onBlur={() => {
        const figure = figureOf(value);
        if (figure !== value) onValueChange(figure);
      }}
    />
  );
}
