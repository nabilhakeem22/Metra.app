// Where a variation line's refusal sits. PURE and client-safe, so the save core
// that writes the path and the form that reads it share one spelling. The core
// answers by POSITION (`lines.<position>.<column>`: it never sees the form's
// rows); the form turns each position into the key of the row it sent there
// (keyedLineErrors), so a refusal stays on its row when another row is removed.

/** The cells of a variation line a refusal can sit under. */
export type VariationLineColumn =
  | 'contractLineId'
  | 'description'
  | 'qty'
  | 'unit'
  | 'unitCost'
  | 'unitPrice'
  | 'discountPct';

/** `row` is the position on the wire, or the row key in the form. */
export function variationLinePath(row: number | string, column: VariationLineColumn): string {
  return `lines.${row}.${column}`;
}

const POSITIONAL = /^lines\.(\d+)\.(.+)$/;

/** The server's positional line paths as the keys of the rows sent (`keys[position]`). */
export function keyedLineErrors<E>(fields: Readonly<Record<string, E>>, keys: readonly string[]): Record<string, E> {
  return Object.fromEntries(
    Object.entries(fields).map(([path, error]) => {
      const match = POSITIONAL.exec(path);
      const key = match ? keys[Number(match[1])] : undefined;
      return [key !== undefined && match ? `lines.${key}.${match[2]}` : path, error];
    }),
  );
}
