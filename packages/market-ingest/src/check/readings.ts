// B9 unresolved readings, B10 rule cited, F10 inferred rows. The B9 list is the
// owner's confirmation list: a non-`read` row may not publish a gap, and an
// `unreadable` row publishes only once every month up to the bulletin month is
// corrected (or the row is skipped in mapping.json).
import { finding, type Finding } from '../findings';
import { RULE_IDS } from '../format';
import type { CheckContext, ResolvedRow } from './context';

const RULE_LIST = new RegExp(`^(${RULE_IDS.join('|')})(\\s*,\\s*(${RULE_IDS.join('|')}))*$`);

function monthsUpTo(bulletinMonth: number): number[] {
  return Array.from({ length: bulletinMonth }, (_, index) => index + 1);
}

function unresolved(resolved: ResolvedRow, bulletinMonth: number): Finding[] {
  const { row, pageId, months, correctedMonths } = resolved;
  const at = { rowId: row.rowId, page: pageId };
  if (row.confidence === 'unreadable') {
    const open = monthsUpTo(bulletinMonth).filter((month) => !correctedMonths.has(month));
    if (open.length === 0) return [];
    return [finding('B9', `"${row.labelAr}" is unreadable; confirm months ${open.join(', ')} on the PDF (corrections.json) or skip the row (mapping.json)`, at)];
  }
  return monthsUpTo(bulletinMonth)
    .filter((month) => months[month - 1] === null && !correctedMonths.has(month))
    .map((month) =>
      finding('B9', `"${row.labelAr}" month ${month} is empty in an inferred row; confirm it on the PDF (corrections.json) or skip the row`, { ...at, month }),
    );
}

export function checkReadings(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  for (const resolved of context.rows) {
    const { row, pageId } = resolved;
    if (row.confidence === 'read') continue;
    const at = { rowId: row.rowId, page: pageId };
    findings.push(...unresolved(resolved, context.bulletinMonth));
    if (row.rule === null || !RULE_LIST.test(row.rule.trim())) {
      findings.push(finding('B10', `a ${row.confidence} row must cite the brief rule that decided it (${RULE_IDS[0]}..${RULE_IDS[RULE_IDS.length - 1]}), found ${JSON.stringify(row.rule)}`, at));
    }
    if (row.confidence === 'inferred') {
      findings.push(finding('F10', `"${row.labelAr}" inferred by ${row.rule ?? 'no rule'}${row.notes ? `: ${row.notes}` : ''}`, at));
    }
  }
  return findings;
}
