import { PDF_BRAND } from '@/lib/pdf/brand';
import { dirFor } from '@/i18n/routing';
import { formatDocNumber } from '@/lib/format/doc-number';
import type { BoqDetail } from '@/lib/boqs/queries/types';
import { hasLineDiscounts } from '@/lib/boqs/line-discounts';
import { esc } from '@/lib/pdf/html';
import { boqLinesTableHtml, boqTotalsHtml, type BoqLayout } from './boq-template-parts';
import { fontFaceCss } from './template';

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
 *
 * LINE DISCOUNTS APPEAR ONLY WHEN GIVEN: a discount % column, and totals that
 * open with the gross and the line discounts, exactly when some line of THIS
 * BOQ has one (`lib/boqs/line-discounts.ts`); otherwise the layout is unchanged.
 * The two tables are `boq-template-parts.ts`.
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
    /** Printed INSTEAD of the BQ number (the builder preview's DRAFT). Inserted
     *  as-is, so it must already be escaped (`pickEscaped`). */
    numberLabel?: string;
  },
): Promise<string> {
  const { locale, variant } = opts;
  const dir = dirFor(locale);
  const num = opts.numberLabel ?? formatDocNumber('BQ', boq.number, opts.year);
  const layout: BoqLayout = {
    locale,
    showCost: variant === 'internal',
    showDiscount: hasLineDiscounts(boq.sections),
  };

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

  ${boqLinesTableHtml(boq, layout, dir)}

  ${boqTotalsHtml(boq, layout)}

  <div class="footer">${esc(opts.orgName)} · ${num}</div>
</body>
</html>`;
}
