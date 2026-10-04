// A mapped proposal as the `BoqDetail` the BOQ PDF template reads. PURE and
// CLIENT-SAFE. Used to render the client copy BEFORE any row exists, so the
// ids are synthetic and the number is the one the commit will allocate.
import type { BoqDetail, BoqLineRow } from '@/lib/boqs/queries/types';
import type { MappedBoq, MappedBoqLine } from './map';

const pick = (ar: string | null, en: string | null) => ar ?? en ?? '';

function toLineRow(
  line: MappedBoqLine,
  id: string,
  showCost: boolean,
): BoqLineRow {
  return {
    id,
    itemCode: line.itemCode,
    description: pick(line.descriptionAr, line.descriptionEn),
    unit: line.unit,
    qty: line.qty,
    unitPrice: line.unitPrice,
    discountPct: line.discountPct,
    lineTotal: line.lineTotal,
    provisional: line.provisional,
    ...(showCost
      ? { unitCost: line.unitCost, lineCost: line.lineCost, lineMargin: line.lineMargin }
      : {}),
  };
}

/**
 * `showCost: false` leaves every cost and margin field OFF the object, not
 * zeroed: the client copy is built from this, and what is absent cannot leak.
 */
export function toBoqDetail(
  mapped: MappedBoq,
  header: { number: number; title: string; currency: string; discountPct: string },
  opts: { showCost: boolean },
): BoqDetail {
  return {
    id: 'unsent',
    number: header.number,
    // Not a stored version yet; the commit computes it. Never displayed.
    version: 0,
    title: header.title,
    status: 'issued',
    source: 'built',
    currency: header.currency,
    discountPct: header.discountPct,
    subtotal: mapped.totals.subtotal,
    discountAmount: mapped.totals.discountAmount,
    total: mapped.totals.total,
    lineCount: mapped.lineCount,
    sections: mapped.sections.map((section, i) => ({
      id: `s${i}`,
      title: pick(section.titleAr, section.titleEn),
      sectionSubtotal: section.sectionSubtotal,
      lines: section.lines.map((line, j) => toLineRow(line, `s${i}l${j}`, opts.showCost)),
    })),
    ...(opts.showCost
      ? { totalCost: mapped.totals.totalCost, totalMargin: mapped.totals.totalMargin }
      : {}),
  };
}
