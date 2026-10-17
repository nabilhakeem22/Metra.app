// F1: a jump above MARKET_FLAG_PCT between consecutive priced months, inside
// this bulletin's series or against the published history. F11: one row on a
// page moves by more than 5% while every sibling stays flat (weak evidence of
// a column slip). Both are flags: jumps are real more often than not.
import { finding, type Finding } from '../findings';
import type { Decimal } from '../format';
import { byCodePoint } from '../order';
import { percentChange } from '../percent';
import { monthKey, type CheckContext, type ResolvedRow } from './context';

const SIBLING_PCT = 5;

interface Point {
  month: string;
  price: Decimal;
  fromFile: boolean;
}

/** The item's priced points: the published history, overlaid by this file. */
function pricedSeries(context: CheckContext, resolved: ResolvedRow): Point[] {
  const byMonth = new Map<string, Point | null>();
  for (const [month, point] of context.history.effective.get(resolved.itemKey) ?? []) {
    byMonth.set(month, point.status === 'priced' && point.price !== null ? { month, price: point.price, fromFile: false } : null);
  }
  resolved.months.forEach((slot, index) => {
    const month = monthKey(context.file, index + 1);
    if (slot === null) return;
    byMonth.set(month, slot === 'suspended' ? null : { month, price: slot, fromFile: true });
  });
  return [...byMonth.values()].filter((point): point is Point => point !== null).sort((a, b) => byCodePoint(a.month, b.month));
}

function checkJumps(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  for (const resolved of context.rows) {
    const series = pricedSeries(context, resolved);
    for (let index = 1; index < series.length; index += 1) {
      const [before, after] = [series[index - 1], series[index]];
      if (!before.fromFile && !after.fromFile) continue;
      const change = percentChange(before.price, after.price);
      if (change === null || Math.abs(Number(change)) <= context.flagPct) continue;
      const origin = before.fromFile ? '' : ' (published)';
      findings.push(
        finding('F1', `"${resolved.row.labelAr}" ${before.month}${origin} ${before.price} -> ${after.month} ${after.price}: ${change}%`, {
          rowId: resolved.row.rowId,
          page: resolved.pageId,
          month: after.fromFile ? Number(after.month.slice(5)) : null,
        }),
      );
    }
  }
  return findings;
}

function checkSiblings(context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const byPage = new Map<number, ResolvedRow[]>();
  for (const resolved of context.rows) byPage.set(resolved.pageId, [...(byPage.get(resolved.pageId) ?? []), resolved]);
  for (const siblings of byPage.values()) {
    for (let month = 2; month <= context.bulletinMonth; month += 1) {
      const changes = siblings.flatMap((resolved) => {
        const [before, after] = [resolved.months[month - 2], resolved.months[month - 1]];
        if (before === null || after === null || before === 'suspended' || after === 'suspended') return [];
        const printed = percentChange(before, after) ?? '0.0';
        return [{ resolved, printed, change: Number(printed) }];
      });
      if (changes.length < 2) continue;
      for (const { resolved, printed, change } of changes) {
        const othersFlat = changes.every((other) => other.resolved === resolved || other.change === 0);
        if (Math.abs(change) > SIBLING_PCT && othersFlat) {
          findings.push(
            finding('F11', `"${resolved.row.labelAr}" moves ${printed}% in month ${month} while every sibling row stays flat: check the column on the PDF`, {
              rowId: resolved.row.rowId,
              page: resolved.pageId,
              month,
            }),
          );
        }
      }
    }
  }
  return findings;
}

export function checkSeries(context: CheckContext): Finding[] {
  return [...checkJumps(context), ...checkSiblings(context)];
}
