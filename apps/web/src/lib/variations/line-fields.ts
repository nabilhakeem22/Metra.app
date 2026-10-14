// Where a variation line's refusal sits: `lines.<position>.<column>`. PURE and
// client-safe, so the save core that writes the path and the form that reads it
// share one spelling. The form keys its rows by position, so a position IS the
// row key here.

/** The cells of a variation line a refusal can sit under. */
export type VariationLineColumn =
  | 'contractLineId'
  | 'description'
  | 'qty'
  | 'unit'
  | 'unitCost'
  | 'unitPrice'
  | 'discountPct';

export function variationLinePath(index: number, column: VariationLineColumn): string {
  return `lines.${index}.${column}`;
}
