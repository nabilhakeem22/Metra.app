import { formatMoney } from '@/lib/format/money';
import { formatPercent, formatQuantity } from '@/lib/format/number';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { ContractDetail } from '@/lib/contracts/queries';
import { fontFaceCss } from './template';

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pick(ar: string | null, en: string | null, locale: string): string {
  const wantAr = locale.startsWith('ar');
  const primary = wantAr ? ar : en;
  const other = wantAr ? en : ar;
  return esc((primary && primary.trim() ? primary : other) ?? '');
}

/**
 * Contract PDF. Same table shape as the proposal PDF (sections + lines + totals),
 * plus the contract header terms (dates, retention/advance, payment) and the
 * revised value when VOs have moved it. Cost + margin appear ONLY on the
 * 'internal' variant; the 'client' variant keeps prices but strips every cost
 * figure (and the query never even loads cost for it). RTL, Western numerals.
 */
export async function buildContractHtml(
  detail: ContractDetail,
  opts: {
    locale: string;
    variant: 'client' | 'internal';
    orgNameAr: string | null;
    orgNameEn: string | null;
  },
): Promise<string> {
  const { locale } = opts;
  const showCost = opts.variant === 'internal';
  const m = (v: string) => formatMoney(v, locale);
  const num = formatDocNumber('C', detail.number, docYear(null, detail.createdAt));
  const orgName = pick(opts.orgNameAr, opts.orgNameEn, locale);
  const clientName = pick(detail.clientNameAr, detail.clientNameEn, locale);
  const title = pick(detail.titleAr, detail.titleEn, locale);
  const extraCols = showCost ? 2 : 0;
  const revised = detail.revisedValue !== detail.originalValue;

  const sectionsHtml = detail.sections
    .map((s) => {
      const rows = s.lines
        .map(
          (l) => `
        <tr>
          <td class="desc">${pick(l.descriptionAr, l.descriptionEn, locale)}</td>
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
      <tr class="section"><td colspan="${5 + extraCols}">${pick(s.titleAr, s.titleEn, locale)}</td></tr>
      ${rows}
      <tr class="subtotal">
        <td colspan="${4 + extraCols}">${'—'}</td>
        <td class="num">${m(s.sectionSubtotal)}</td>
        ${showCost ? '<td></td>' : ''}
      </tr>`;
    })
    .join('');

  const termRow = (label: string, value: string) =>
    `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;

  return `<!doctype html>
<html lang="${locale}" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  ${await fontFaceCss()}
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans Arabic', 'Cairo', sans-serif; margin: 0; padding: 32px; color: #0f172a; font-size: 13px; }
  h1 { font-family: 'Cairo'; font-weight: 800; font-size: 20px; margin: 0 0 2px; }
  .meta { color: #475569; margin-block-end: 16px; font-size: 12px; }
  .meta strong { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-block-end: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 10px; }
  th { background: #0f766e; color: #fff; text-align: start; font-size: 12px; }
  td.desc { text-align: start; }
  td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; }
  tr.section td { background: #e2e8f0; font-weight: 700; text-align: start; }
  tr.subtotal td { background: #f8fafc; font-weight: 600; }
  .totals { width: 340px; margin-inline-start: auto; }
  .totals td { border: none; padding: 4px 8px; }
  .totals td.num { text-align: end; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { font-weight: 800; border-top: 2px solid #0f172a; }
  .terms { margin-block-start: 16px; font-size: 12px; }
  .footer { margin-block-start: 24px; color: #64748b; font-size: 11px; text-align: center; }
</style>
</head>
<body>
  <h1>${orgName || 'Metra'}</h1>
  <div class="meta">
    <div><strong>${num}</strong> — ${title}</div>
    <div>${clientName}</div>
  </div>

  <table dir="rtl">
    <thead>
      <tr>
        <th>${pick('الوصف', 'Description', locale)}</th>
        <th class="num">${pick('الكمية', 'Qty', locale)}</th>
        ${showCost ? `<th class="num">${pick('التكلفة', 'Cost', locale)}</th>` : ''}
        <th class="num">${pick('سعر الوحدة', 'Unit price', locale)}</th>
        <th class="num">${pick('خصم', 'Disc', locale)}</th>
        <th class="num">${pick('الإجمالي', 'Total', locale)}</th>
        ${showCost ? `<th class="num">${pick('الهامش', 'Margin', locale)}</th>` : ''}
      </tr>
    </thead>
    <tbody>
      ${sectionsHtml}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>${pick('المجموع الفرعي', 'Subtotal', locale)}</td><td class="num">${m(detail.subtotal)}</td></tr>
    <tr><td>${pick('الخصم', 'Discount', locale)}</td><td class="num">${m(detail.discountAmount)}</td></tr>
    <tr><td>${pick('ضريبة القيمة المضافة', 'VAT', locale)} (${formatPercent(detail.taxRate, locale)})</td><td class="num">${m(detail.taxAmount)}</td></tr>
    <tr><td>${pick('الإشراف', 'Supervision', locale)} (${formatPercent(detail.supervisionPct, locale)})</td><td class="num">${m(detail.supervisionAmount)}</td></tr>
    <tr class="grand"><td>${pick('قيمة العقد الأصلية', 'Original value', locale)}</td><td class="num">${m(detail.originalValue)}</td></tr>
    ${revised ? `<tr class="grand"><td>${pick('القيمة بعد التعديلات', 'Revised value', locale)}</td><td class="num">${m(detail.revisedValue)}</td></tr>` : ''}
    ${showCost && detail.totalMargin !== undefined ? `<tr><td>${pick('هامش الربح', 'Margin', locale)}</td><td class="num">${m(detail.totalMargin)}</td></tr>` : ''}
  </table>

  <table class="terms totals">
    ${termRow(pick('نسبة الدفعة المقدمة', 'Advance %', locale), formatPercent(detail.advancePct, locale))}
    ${termRow(pick('نسبة المحتجز', 'Retention %', locale), formatPercent(detail.retentionPct, locale))}
    ${detail.paymentTermsDays != null ? termRow(pick('مدة السداد (يوم)', 'Payment terms (days)', locale), String(detail.paymentTermsDays)) : ''}
    ${detail.startDate ? termRow(pick('تاريخ البدء', 'Start date', locale), esc(detail.startDate)) : ''}
    ${detail.endDate ? termRow(pick('تاريخ الانتهاء', 'End date', locale), esc(detail.endDate)) : ''}
  </table>

  <div class="footer">${esc(orgName)} · ${num}</div>
</body>
</html>`;
}
