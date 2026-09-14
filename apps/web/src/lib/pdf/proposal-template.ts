import { PDF_BRAND } from '@/lib/pdf/brand';

import { formatMoney } from '@/lib/format/money';
import { formatPercent, formatQuantity } from '@/lib/format/number';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { dirFor } from '@/i18n/routing';
import { esc, pickEscaped } from '@/lib/pdf/html';
import { fontFaceCss } from './template';

/**
 * Proposal PDF. Groups lines under section headings, each with a subtotal row,
 * then the document subtotal -> discount -> VAT -> supervision -> total. Cost and
 * margin (per-line cost + document cost/margin) appear ONLY on the 'internal'
 * variant; the 'client' variant keeps prices but strips every cost figure.
 * Supervision is NOT a cost — the client pays it — so it shows on BOTH variants.
 * Direction follows the locale (Arabic RTL, English LTR); Western numerals via
 * formatMoney. Single render source for route+preview.
 */
export async function buildProposalHtml(
  detail: ProposalDetail,
  opts: {
    locale: string;
    variant: 'client' | 'internal';
    orgNameAr: string | null;
    orgNameEn: string | null;
  },
): Promise<string> {
  const { locale } = opts;
  const dir = dirFor(locale);
  const showCost = opts.variant === 'internal';
  const m = (v: string) => formatMoney(v, locale);
  const num = formatProposalNumber(
    detail.number,
    proposalYear(detail.issueDate, detail.createdAt),
  );
  const orgName = pickEscaped(opts.orgNameAr, opts.orgNameEn, locale);
  const clientName = pickEscaped(detail.clientNameAr, detail.clientNameEn, locale);
  const title = pickEscaped(detail.titleAr, detail.titleEn, locale);
  const extraCols = showCost ? 2 : 0;

  const sectionsHtml = detail.sections
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

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
  ${await fontFaceCss()}
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans Arabic', 'Cairo', sans-serif; margin: 0; padding: 32px; color: ${PDF_BRAND.text}; font-size: 13px; }
  h1 { font-family: 'Cairo'; font-weight: 800; font-size: 20px; margin: 0 0 2px; }
  .meta { color: ${PDF_BRAND.muted}; margin-block-end: 16px; font-size: 12px; }
  .meta strong { color: ${PDF_BRAND.text}; }
  table { width: 100%; border-collapse: collapse; margin-block-end: 16px; }
  th, td { border: 1px solid ${PDF_BRAND.rule}; padding: 6px 10px; }
  th { background: ${PDF_BRAND.brand}; color: ${PDF_BRAND.onBrand}; text-align: start; font-size: 12px; }
  td.desc { text-align: start; }
  td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; }
  tr.section td { background: ${PDF_BRAND.sectionRow}; font-weight: 700; text-align: start; }
  tr.subtotal td { background: ${PDF_BRAND.subtotalRow}; font-weight: 600; }
  .totals { width: 320px; margin-inline-start: auto; }
  .totals td { border: none; padding: 4px 8px; }
  .totals td.num { text-align: end; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { font-weight: 800; border-top: 2px solid ${PDF_BRAND.text}; }
  .footer { margin-block-start: 24px; color: ${PDF_BRAND.faint}; font-size: 11px; text-align: center; }
</style>
</head>
<body>
  <h1>${orgName || 'Metra'}</h1>
  <div class="meta">
    <div><strong>${num}</strong> — ${title}</div>
    <div>${clientName}</div>
  </div>

  <table dir="${dir}">
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
  </table>

  <table class="totals">
    <tr><td>${pickEscaped('المجموع الفرعي', 'Subtotal', locale)}</td><td class="num">${m(detail.subtotal)}</td></tr>
    <tr><td>${pickEscaped('الخصم', 'Discount', locale)}</td><td class="num">${m(detail.discountAmount)}</td></tr>
    <tr><td>${pickEscaped('ضريبة القيمة المضافة', 'VAT', locale)} (${formatPercent(detail.taxRate, locale)})</td><td class="num">${m(detail.taxAmount)}</td></tr>
    <tr><td>${pickEscaped('الإشراف', 'Supervision', locale)} (${formatPercent(detail.supervisionPct, locale)})</td><td class="num">${m(detail.supervisionAmount)}</td></tr>
    <tr class="grand"><td>${pickEscaped('الإجمالي', 'Total', locale)}</td><td class="num">${m(detail.total)}</td></tr>
    ${showCost && detail.totalMargin !== undefined ? `<tr><td>${pickEscaped('هامش الربح', 'Margin', locale)}</td><td class="num">${m(detail.totalMargin)}</td></tr>` : ''}
  </table>

  <div class="footer">${orgName} · ${num}</div>
</body>
</html>`;
}
