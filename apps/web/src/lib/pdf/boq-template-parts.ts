// The two TABLES of the BOQ PDF: the priced lines and the totals. Split from
// `boq-template.ts`, which keeps the document shell (styles, heading, footer),
// so each half stays readable as the layout grew a conditional column.
import { formatMoney } from '@/lib/format/money';
import { formatPercent, formatQuantity } from '@/lib/format/number';
import type { BoqDetail, BoqLineRow } from '@/lib/boqs/queries/types';
import { lineDiscountTotals } from '@/lib/boqs/line-discounts';
import { esc } from '@/lib/pdf/html';

const UNIT_LABEL: Record<string, [string, string]> = {
  sqm: ['م²', 'm²'],
  linear_meter: ['م.ط', 'm.l'],
  pcs: ['عدد', 'pcs'],
  lump_sum: ['مقطوعية', 'lump sum'],
  day: ['يوم', 'day'],
};

/** What varies the layout of ONE document. */
export interface BoqLayout {
  locale: string;
  /** The internal variant: unit cost and line cost columns, cost and margin rows. */
  showCost: boolean;
  /** Some line of THIS BOQ carries a discount (`hasLineDiscounts`). */
  showDiscount: boolean;
}

export const pickText = (locale: string, ar: string, en: string) =>
  esc(locale.startsWith('ar') ? ar : en);

/** Columns before the amount: description, unit, qty, rate, [disc], [cost x2]. */
export function boqColumnCount(layout: BoqLayout): number {
  return 5 + (layout.showDiscount ? 1 : 0) + (layout.showCost ? 2 : 0);
}

function lineRowHtml(line: BoqLineRow, layout: BoqLayout): string {
  const { locale } = layout;
  const m = (value: string) => formatMoney(value, locale);
  const unit = UNIT_LABEL[line.unit] ?? [line.unit, line.unit];
  const flag = line.provisional
    ? ` <span class="prov">${pickText(locale, 'تقديري', 'provisional')}</span>`
    : '';
  const code = line.itemCode ? `<span class="code">${esc(line.itemCode)}</span> ` : '';
  return `<tr>
            <td class="desc">${code}${esc(line.description)}${flag}</td>
            <td>${pickText(locale, unit[0], unit[1])}</td>
            <td class="num">${formatQuantity(line.qty, locale)}</td>
            <td class="num">${m(line.unitPrice)}</td>
            ${layout.showDiscount ? `<td class="num">${formatPercent(line.discountPct, locale)}</td>` : ''}
            ${layout.showCost ? `<td class="num">${m(line.unitCost ?? '0')}</td>` : ''}
            ${layout.showCost ? `<td class="num">${m(line.lineCost ?? '0')}</td>` : ''}
            <td class="num">${m(line.lineTotal)}</td>
          </tr>`;
}

/** The header row and every section's lines and subtotal. */
export function boqLinesTableHtml(boq: BoqDetail, layout: BoqLayout, dir: string): string {
  const { locale } = layout;
  const colCount = boqColumnCount(layout);
  const rows = boq.sections
    .map((section) => {
      const head = `<tr class="section"><td colspan="${colCount}">${esc(section.title)}</td></tr>`;
      const lines = section.lines.map((line) => lineRowHtml(line, layout)).join('');
      const subtotal = `<tr class="subtotal">
        <td colspan="${colCount - 1}">${pickText(locale, 'إجمالي البند', 'Section subtotal')}</td>
        <td class="num">${formatMoney(section.sectionSubtotal, locale)}</td>
      </tr>`;
      return head + lines + subtotal;
    })
    .join('');
  const th = (ar: string, en: string, num = true) =>
    `<th${num ? ' class="num"' : ''}>${pickText(locale, ar, en)}</th>`;
  return `<table dir="${dir}">
    <thead>
      <tr>
        ${th('الوصف', 'Description', false)}
        ${th('الوحدة', 'Unit', false)}
        ${th('الكمية', 'Qty')}
        ${th('سعر الوحدة', 'Unit price')}
        ${layout.showDiscount ? th('نسبة الخصم', 'Discount %') : ''}
        ${layout.showCost ? th('تكلفة الوحدة', 'Unit cost') : ''}
        ${layout.showCost ? th('إجمالي التكلفة', 'Line cost') : ''}
        ${th('الإجمالي', 'Total')}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const row = (label: string, value: string) =>
  `<tr><td>${label}</td><td class="num">${value}</td></tr>`;

/**
 * The totals. Without line discounts this is exactly the layout every BOQ had:
 * subtotal, the document discount when there is one, total. With them it opens
 * with the gross and what the line discounts took off, and the subtotal is named
 * as what it is, so every printed step subtracts to the next.
 */
export function boqTotalsHtml(boq: BoqDetail, layout: BoqLayout): string {
  const { locale } = layout;
  const t = (ar: string, en: string) => pickText(locale, ar, en);
  const m = (value: string) => formatMoney(value, locale);
  const hasDocumentDiscount = boq.discountAmount !== '0.0000' && boq.discountAmount !== '0';
  const lines = layout.showDiscount ? lineDiscountTotals(boq.sections) : null;
  const opening = lines
    ? row(t('الإجمالي قبل الخصومات', 'Total before discounts'), m(lines.gross)) +
      row(t('خصومات البنود', 'Line discounts'), `-${m(lines.lineDiscounts)}`) +
      row(t('الإجمالي بعد خصومات البنود', 'Subtotal after line discounts'), m(boq.subtotal))
    : row(t('الإجمالي قبل الخصم', 'Subtotal'), m(boq.subtotal));
  const documentDiscount = hasDocumentDiscount
    ? row(
        lines ? t('الخصم الإجمالي', 'Overall discount') : t('الخصم', 'Discount'),
        `-${m(boq.discountAmount)}`,
      )
    : '';
  const cost = layout.showCost
    ? row(t('إجمالي التكلفة', 'Total cost'), m(boq.totalCost ?? '0')) +
      row(t('هامش الربح', 'Margin'), m(boq.totalMargin ?? '0'))
    : '';
  return `<table class="totals">
    <tbody>
      ${opening}${documentDiscount}${cost}
      <tr class="grand">
        <td>${t('الإجمالي', 'Total')}</td>
        <td class="num">${m(boq.total)}</td>
      </tr>
    </tbody>
  </table>`;
}
