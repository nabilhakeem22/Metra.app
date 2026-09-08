import { PDF_BRAND } from '@/lib/pdf/brand';
import { dirFor } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';
import type { BoqDetail } from '@/lib/boqs/queries';
import { fontFaceCss } from './template';

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const t = (locale: string, ar: string, en: string) =>
  esc(locale.startsWith('ar') ? ar : en);

const UNIT_LABEL: Record<string, [string, string]> = {
  sqm: ['م²', 'm²'],
  linear_meter: ['م.ط', 'm.l'],
  pcs: ['عدد', 'pcs'],
  lump_sum: ['مقطوعية', 'lump sum'],
  day: ['يوم', 'day'],
};

/** `BQ-2026-0007` — the same shape as a proposal or contract number. */
export function formatBoqNumber(number: number, year: number): string {
  return `BQ-${year}-${String(number).padStart(4, '0')}`;
}

/**
 * Bill of Quantities PDF — the document the client actually receives.
 *
 * THE VARIANT SPLIT IS THE WHOLE SAFETY PROPERTY HERE. Every BOQ line carries a
 * unit cost, a line cost and a line margin alongside its rate, and this is the
 * document the studio is PAID for. The 'client' variant renders rates and totals
 * only; 'internal' adds the cost columns. A single leaked column hands the client
 * the firm's margin, so `boq-template.test.ts` sweeps the rendered client output
 * for every cost figure rather than trusting the template to be read correctly.
 *
 * Direction follows the LOCALE (Arabic RTL, English LTR) from the start — the
 * proposal and contract templates shipped with dir="rtl" hardcoded and sent
 * English documents laid out right-to-left until it was fixed.
 *
 * No tax and no supervision: a BOQ prices the works, and the commercial wrapper
 * is added when it becomes an execution contract.
 */
export async function buildBoqHtml(
  boq: BoqDetail,
  opts: {
    locale: string;
    variant: 'client' | 'internal';
    orgName: string;
    clientName: string;
    projectName: string;
    year: number;
  },
): Promise<string> {
  const { locale, variant } = opts;
  const dir = dirFor(locale);
  const showCost = variant === 'internal';
  const m = (v: string) => formatMoney(v, locale);
  const num = formatBoqNumber(boq.number, opts.year);

  const colCount = showCost ? 7 : 5;

  const rows = boq.sections
    .map((section) => {
      const head = `<tr class="section"><td colspan="${colCount}">${esc(section.title)}</td></tr>`;
      const lines = section.lines
        .map((line) => {
          const unit = UNIT_LABEL[line.unit] ?? [line.unit, line.unit];
          const flag = line.provisional
            ? ` <span class="prov">${t(locale, 'تقديري', 'provisional')}</span>`
            : '';
          const code = line.itemCode
            ? `<span class="code">${esc(line.itemCode)}</span> `
            : '';
          return `<tr>
            <td class="desc">${code}${esc(line.description)}${flag}</td>
            <td>${t(locale, unit[0], unit[1])}</td>
            <td class="num">${formatQuantity(line.qty, locale)}</td>
            <td class="num">${m(line.unitPrice)}</td>
            ${showCost ? `<td class="num">${m(line.unitCost ?? '0')}</td>` : ''}
            ${showCost ? `<td class="num">${m(line.lineCost ?? '0')}</td>` : ''}
            <td class="num">${m(line.lineTotal)}</td>
          </tr>`;
        })
        .join('');
      const subtotal = `<tr class="subtotal">
        <td colspan="${colCount - 1}">${t(locale, 'إجمالي البند', 'Section subtotal')}</td>
        <td class="num">${m(section.sectionSubtotal)}</td>
      </tr>`;
      return head + lines + subtotal;
    })
    .join('');

  const hasDiscount = boq.discountAmount !== '0.0000' && boq.discountAmount !== '0';

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
  .code { color: ${PDF_BRAND.muted}; font-size: 11px; }
  .prov { color: ${PDF_BRAND.muted}; font-size: 11px; }
  .totals { width: 320px; margin-inline-start: auto; }
  .totals td { border: none; padding: 4px 8px; }
  .totals td.num { text-align: end; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { font-weight: 800; border-top: 2px solid ${PDF_BRAND.text}; }
  .footer { margin-block-start: 24px; color: ${PDF_BRAND.faint}; font-size: 11px; text-align: center; }
</style>
</head>
<body>
  <h1>${esc(opts.orgName) || 'Metra'}</h1>
  <div class="meta">
    <div><strong>${num}</strong> — ${esc(boq.title)}</div>
    <div>${esc(opts.clientName)} · ${esc(opts.projectName)}</div>
  </div>

  <table dir="${dir}">
    <thead>
      <tr>
        <th>${t(locale, 'الوصف', 'Description')}</th>
        <th>${t(locale, 'الوحدة', 'Unit')}</th>
        <th class="num">${t(locale, 'الكمية', 'Qty')}</th>
        <th class="num">${t(locale, 'سعر الوحدة', 'Unit price')}</th>
        ${showCost ? `<th class="num">${t(locale, 'تكلفة الوحدة', 'Unit cost')}</th>` : ''}
        ${showCost ? `<th class="num">${t(locale, 'إجمالي التكلفة', 'Line cost')}</th>` : ''}
        <th class="num">${t(locale, 'الإجمالي', 'Total')}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tbody>
      <tr>
        <td>${t(locale, 'الإجمالي قبل الخصم', 'Subtotal')}</td>
        <td class="num">${m(boq.subtotal)}</td>
      </tr>
      ${
        hasDiscount
          ? `<tr><td>${t(locale, 'الخصم', 'Discount')}</td><td class="num">-${m(boq.discountAmount)}</td></tr>`
          : ''
      }
      ${
        showCost
          ? `<tr><td>${t(locale, 'إجمالي التكلفة', 'Total cost')}</td><td class="num">${m(boq.totalCost ?? '0')}</td></tr>
             <tr><td>${t(locale, 'هامش الربح', 'Margin')}</td><td class="num">${m(boq.totalMargin ?? '0')}</td></tr>`
          : ''
      }
      <tr class="grand">
        <td>${t(locale, 'الإجمالي', 'Total')}</td>
        <td class="num">${m(boq.total)} ${esc(boq.currency)}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">${esc(opts.orgName)} · ${num}</div>
</body>
</html>`;
}
