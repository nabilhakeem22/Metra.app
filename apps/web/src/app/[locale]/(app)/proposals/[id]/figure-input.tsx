'use client';

import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { figureOf } from './builder-model';
import { compactFigure } from './figure-display';

/**
 * A builder number box. It takes what the studio types (Arabic-Indic digits,
 * "1,000", a trailing dot) and, on blur, rewrites itself to the figure that will
 * be saved, in Latin digits (`figureOf`), so the box never shows a number
 * different from the one the preview and the save use. Anything it cannot read
 * ("1,5", letters) is left as typed for the save to point at.
 *
 * A figure it is not editing shows without trailing zeros ("13200.0000" reads
 * "13200", ./figure-display.ts). Focusing the box keeps that text, and only what
 * the studio then types reaches the line: the stored figure is never rewritten
 * by looking at it, and nothing typed is trimmed while it is being typed.
 */
export function FigureInput({
  value,
  onValueChange,
  onFocus,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  // What the box shows while focused, and the line figure it was shown for: a
  // figure that changed from elsewhere meanwhile (a price-book pick) wins.
  const [editing, setEditing] = useState<{ text: string; forValue: string } | null>(null);
  const shown = editing && editing.forValue === value ? editing.text : compactFigure(value);

  return (
    <Input
      {...props}
      dir="ltr"
      inputMode="decimal"
      value={shown}
      onFocus={(event) => {
        setEditing({ text: compactFigure(value), forValue: value });
        onFocus?.(event);
      }}
      onChange={(event) => {
        setEditing({ text: event.target.value, forValue: event.target.value });
        onValueChange(event.target.value);
      }}
      onBlur={() => {
        setEditing(null);
        const figure = figureOf(value);
        if (figure !== value) onValueChange(figure);
      }}
    />
  );
}
