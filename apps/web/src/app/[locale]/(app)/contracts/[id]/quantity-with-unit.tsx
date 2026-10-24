'use client';

import { useUnitLabel } from '@/hooks/use-unit-label';

/**
 * A formatted quantity and its unit as one figure: the number pinned LTR in
 * tabular digits, the unit named in the page's language (the price book's unit
 * names, never the stored code), so an Arabic page reads "220 م²" from the
 * right and an English one "220 m²".
 */
export function QuantityWithUnit({ qty, unit }: { qty: string; unit: string }) {
  const unitLabel = useUnitLabel();
  return (
    <span>
      <span dir="ltr" className="font-mono tabular-nums">
        {qty}
      </span>{' '}
      {unitLabel(unit)}
    </span>
  );
}
