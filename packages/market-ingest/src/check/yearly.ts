// F8: the charted row against the printed yearly % (computed from the previous
// year's price and this year's table value). F9: the printed «المتوسط», which
// is the PREVIOUS year's average, against the previous-year column as read.
// Both only list; the checker never changes a value.
import { finding, type Finding } from '../findings';
import type { Decimal } from '../format';
import { percentChange } from '@metra/db/market-percent';
import type { CheckContext } from './context';

function tolerance(printed: string): number {
  return printed.includes('.') ? 0.15 : 1;
}

function averageDisagrees(previousYear: (Decimal | null | 'suspended')[], printedAverage: Decimal): string | null {
  const values = previousYear.filter((slot): slot is Decimal => slot !== null && slot !== 'suspended').map(Number);
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const rounded = Math.round(mean);
  return Math.abs(rounded - Number(printedAverage)) > 1
    ? `the previous-year column averages ${rounded} but «المتوسط» prints ${printedAverage}: re-read the previous-year column`
    : null;
}

export function checkYearly(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  for (const { row, page, pageId, months } of context.rows) {
    const yearly = page.yearly;
    if (yearly?.rowId !== row.rowId) continue;
    const at = { rowId: row.rowId, page: pageId };
    for (let month = 1; month <= context.bulletinMonth; month += 1) {
      const current = months[month - 1];
      const previous = yearly.previousYear[month - 1];
      const printed = yearly.printedPct[month - 1];
      if (current === null || current === 'suspended' || previous === null || previous === 'suspended' || printed === null) continue;
      const computed = percentChange(previous, current);
      if (computed !== null && Math.abs(Number(computed) - Number(printed)) > tolerance(printed)) {
        findings.push(
          finding('F8', `month ${month}: ${previous} -> ${current} is ${computed}% but the yearly table prints ${printed}%; keep the table value unless the PDF says otherwise`, { ...at, month }),
        );
      }
    }
    if (yearly.printedAverage !== null) {
      const problem = averageDisagrees(yearly.previousYear, yearly.printedAverage);
      if (problem) findings.push(finding('F9', problem, at));
    }
  }
  return findings;
}
