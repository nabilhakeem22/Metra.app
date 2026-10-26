// The priced-lines TABLE the proposal and contract PDFs share: one heading row
// per section, its lines, and a subtotal row. Cost and margin columns appear
// ONLY when `showCost` (the 'internal' variant); the client variant never
// prints a cost figure. Each document keeps its own shell (styles, heading,
// totals, terms, footer).
import { formatMoney } from '@/lib/format/money';
import { formatPercent, formatQuantity } from '@/lib/format/number';
import { esc, pickEscaped } from '@/lib/pdf/html';

interface PricedLine {
  descriptionAr: string | null;
  descriptionEn: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  lineTotal: string;
  /** Margin-gated: absent unless the caller may see cost. */
  unitCost?: string;
  lineMargin?: string;
}

interface PricedSection {
  titleAr: string | null;
  titleEn: string | null;
  sectionSubtotal: string;
  lines: PricedLine[];
}

export function pricedSectionsTableHtml(
  sections: PricedSection[],
  layout: { locale: string; dir: 'rtl' | 'ltr'; showCost: boolean },
): string {
  const { locale, dir, showCost } = layout;
  const m = (v: string) => formatMoney(v, locale);
  const extraCols = showCost ? 2 : 0;

  const sectionsHtml = sections
    .map((s) => {
      const rows = s.lines
        .map(
          (l) => `
        <tr>
          <td class="desc">${pickEscaped(l.descriptionAr, l.descriptionEn, locale)}</td>
          <td class="num">${formatQuantity(l.qty, locale)} ${esc(l.unit)}</td>
          ${showCost ? `<td class="num">${m(l.unitCost ?? '0')}</td>` : ''}
          <td class="num">${m(l.unitPrice)}</td>
          <td class="num">${formatPercent(l.discountPct, locale)}</td>
          <td class="num">${m(l.lineTotal)}</td>
          ${showCost ? `<td class="num">${m(l.lineMargin ?? '0')}</td>` : ''}
        </tr>`,
        )
        .join('');
      return `
      <tr class="section"><td colspan="${5 + extraCols}">${pickEscaped(s.titleAr, s.titleEn, locale)}</td></tr>
      ${rows}
      <tr class="subtotal">
        <td colspan="${4 + extraCols}">${'—'}</td>
        <td class="num">${m(s.sectionSubtotal)}</td>
        ${showCost ? '<td></td>' : ''}
      </tr>`;
    })
    .join('');

  return `<table dir="${dir}">
    <thead>
      <tr>
        <th>${pickEscaped('الوصف', 'Description', locale)}</th>
        <th class="num">${pickEscaped('الكمية', 'Qty', locale)}</th>
        ${showCost ? `<th class="num">${pickEscaped('التكلفة', 'Cost', locale)}</th>` : ''}
        <th class="num">${pickEscaped('سعر الوحدة', 'Unit price', locale)}</th>
        <th class="num">${pickEscaped('خصم', 'Disc', locale)}</th>
        <th class="num">${pickEscaped('الإجمالي', 'Total', locale)}</th>
        ${showCost ? `<th class="num">${pickEscaped('الهامش', 'Margin', locale)}</th>` : ''}
      </tr>
    </thead>
    <tbody>
      ${sectionsHtml}
    </tbody>
  </table>`;
}
