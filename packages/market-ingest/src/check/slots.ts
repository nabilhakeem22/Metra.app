// B1: no value after the bulletin month. B2: every value is > 0 and at most
// 10,000,000, which catches unsplit merges such as 1596029811.
import { finding, type Finding } from '../findings';
import type { Slot } from '../format';
import { decimalExceeds } from '@metra/db/market-percent';
import type { CheckContext } from './context';

const MAXIMUM_VALUE = '10000000';

function valueProblem(value: Slot): string | null {
  if (value === null || value === 'suspended') return null;
  if (!/[1-9]/.test(value)) return `"${value}" is not above zero`;
  if (decimalExceeds(value, MAXIMUM_VALUE)) {
    return `"${value}" is above 10,000,000: two merged cells? Split it by the sibling rows (R6) or correct it`;
  }
  return null;
}

export function checkSlots(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  for (const { row, pageId, months, page } of context.rows) {
    const at = { rowId: row.rowId, page: pageId };
    months.forEach((slot, index) => {
      const month = index + 1;
      if (month > context.bulletinMonth && slot !== null) {
        findings.push(finding('B1', `month ${month} is after the bulletin month ${context.bulletinMonth} and must be null`, { ...at, month }));
      }
      const problem = valueProblem(slot);
      if (problem) findings.push(finding('B2', problem, { ...at, month }));
    });
    if (page.yearly?.rowId === row.rowId) {
      page.yearly.previousYear.forEach((slot, index) => {
        const problem = valueProblem(slot);
        if (problem) findings.push(finding('B2', `previous year: ${problem}`, { ...at, month: index + 1 }));
      });
    }
  }
  return findings;
}
