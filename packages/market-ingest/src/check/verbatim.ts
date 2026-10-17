// B12: a value read from the PDF must be exactly what its printed cell says.
// The producer writes each cell as printed (Arabic-Indic digits, «،» as the
// decimal mark) AND its Western value; this re-reads the cell and compares.
// A month the owner corrected is exempt: the correction is the confirmed value.
import { finding, type Finding } from '../findings';
import { canonicalDecimal, verbatimCellNumber } from '../normalize';
import type { CheckContext } from './context';

function mismatch(cell: string | null, slot: string | null): string | null {
  const printed = cell === null || cell.trim() === '' ? null : cell;
  if (slot === null) return printed === null ? null : `the cell reads "${printed}" but the value is empty`;
  if (printed === null) return `the value is "${slot}" but the cell is empty`;
  const number = verbatimCellNumber(printed);
  if (slot === 'suspended') return number === null ? null : `the cell reads the number ${number} but the value is "suspended"`;
  if (number === null) return `the cell "${printed}" is not one number, but the value is "${slot}"`;
  return number === canonicalDecimal(slot) ? null : `the cell "${printed}" reads ${number}, but the value is "${slot}"`;
}

export function checkVerbatim(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  for (const { row, pageId, correctedMonths } of context.rows) {
    if (row.verbatimCells === null) continue;
    row.months.forEach((slot, index) => {
      const month = index + 1;
      if (correctedMonths.has(month)) return;
      const problem = mismatch(row.verbatimCells?.[index] ?? null, slot);
      if (problem) findings.push(finding('B12', problem, { rowId: row.rowId, page: pageId, month }));
    });
  }
  return findings;
}
