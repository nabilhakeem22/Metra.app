import { describe, expect, it, vi } from 'vitest';

// ./template reaches @/lib/cf/context, which is `server-only` and calls
// getCloudflareContext(); the BoqDetail type comes from a `server-only` query
// module. Stub both so the builder runs in Node — fontFaceCss() degrades to ''
// off-platform, which is exactly what these tests want: the markup, not the
// embedded fonts. Same stubs the proposal and contract template tests use.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => false,
  cfEnv: () => {
    throw new Error('getCloudflareContext() called off-platform');
  },
}));
import type { BoqDetail } from '@/lib/boqs/queries';
import { buildBoqHtml, formatBoqNumber } from './boq-template';

const detail = (over: Partial<BoqDetail> = {}): BoqDetail => ({
  id: 'b1',
  number: 7,
  title: 'Bill of Quantities',
  status: 'issued',
  source: 'imported',
  currency: 'EGP',
  discountPct: '0',
  subtotal: '159900.0000',
  discountAmount: '0.0000',
  total: '159900.0000',
  lineCount: 2,
  totalCost: '96295.0000',
  totalMargin: '63605.0000',
  sections: [
    {
      id: 's1',
      title: 'Gypsum works',
      sectionSubtotal: '159900.0000',
      lines: [
        {
          id: 'l1',
          itemCode: '2.01',
          description: '12mm gypsum ceiling',
          unit: 'sqm',
          qty: '100.0000',
          unitPrice: '1500.0000',
          lineTotal: '150000.0000',
          provisional: false,
          unitCost: '913.0000',
          lineCost: '91300.0000',
          lineMargin: '58700.0000',
        },
        {
          id: 'l2',
          itemCode: null,
          description: 'كرانيش جبسية',
          unit: 'linear_meter',
          qty: '45.0000',
          unitPrice: '220.0000',
          lineTotal: '9900.0000',
          provisional: true,
          unitCost: '111.0000',
          lineCost: '4995.0000',
          lineMargin: '4905.0000',
        },
      ],
    },
  ],
  ...over,
});

const opts = {
  locale: 'en',
  variant: 'client' as const,
  orgName: 'Studio Nine',
  clientName: 'Rehab',
  projectName: 'New Cairo apartment',
  year: 2026,
};

describe('formatBoqNumber', () => {
  it('pads to the same shape as a proposal or contract number', () => {
    expect(formatBoqNumber(7, 2026)).toBe('BQ-2026-0007');
    expect(formatBoqNumber(1284, 2026)).toBe('BQ-2026-1284');
  });
});

describe('the client variant', () => {
  it('renders NO cost figure anywhere', async () => {
    // The safety property of this whole document. Swept from the rendered output
    // rather than read off the template, because a single leaked column hands the
    // client the firm's margin on the document the studio is paid for.
    const html = await buildBoqHtml(detail(), opts);
    // Every cost figure is chosen so it cannot appear as a SUBSTRING of a
    // legitimate one. The first draft used 900.00 as the unit cost and the sweep
    // matched it inside the line total 9,900.00 — a false alarm that would have
    // made this test untrustworthy the first time it fired for real.
    const forbidden = [
      '913.00', // unit cost
      '91,300.00', // line cost
      '58,700.00', // line margin
      '111.00', // unit cost, second line
      '4,995.00', // line cost, second line
      '4,905.00', // line margin, second line
      '96,295.00', // total cost
      '63,605.00', // total margin
    ];
    for (const figure of forbidden) {
      expect(html, `client PDF leaked ${figure}`).not.toContain(figure);
    }
    expect(html).not.toContain('Unit cost');
    expect(html).not.toContain('Margin');
  });

  it('still renders rates, quantities and totals', async () => {
    const html = await buildBoqHtml(detail(), opts);
    expect(html).toContain('1,500.00');
    expect(html).toContain('150,000.00');
    expect(html).toContain('159,900.00');
    expect(html).toContain('12mm gypsum ceiling');
  });
});

describe('the internal variant', () => {
  it('adds the cost columns the client copy withholds', async () => {
    const html = await buildBoqHtml(detail(), { ...opts, variant: 'internal' });
    expect(html).toContain('Unit cost');
    expect(html).toContain('91,300.00');
    expect(html).toContain('96,295.00');
    expect(html).toContain('63,605.00');
  });
});

describe('direction and language', () => {
  it('lays an English document left-to-right', async () => {
    // The proposal and contract templates shipped with dir="rtl" hardcoded and
    // sent English documents laid out right-to-left. This one starts correct.
    const html = await buildBoqHtml(detail(), opts);
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
  });

  it('lays an Arabic document right-to-left, with Arabic headers', async () => {
    const html = await buildBoqHtml(detail(), { ...opts, locale: 'ar-EG' });
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('سعر الوحدة');
    expect(html).toContain('الكمية');
  });

  it('labels units in the document’s own language', async () => {
    const en = await buildBoqHtml(detail(), opts);
    expect(en).toContain('m²');
    const ar = await buildBoqHtml(detail(), { ...opts, locale: 'ar-EG' });
    expect(ar).toContain('م²');
  });
});

describe('the document body', () => {
  it('marks a provisional line so the client knows it will be remeasured', async () => {
    const html = await buildBoqHtml(detail(), opts);
    expect(html).toContain('provisional');
  });

  it('shows a discount row only when there is a discount', async () => {
    const without = await buildBoqHtml(detail(), opts);
    expect(without).not.toContain('Discount');
    const withDiscount = await buildBoqHtml(
      detail({ discountAmount: '15990.0000', total: '143910.0000' }),
      opts,
    );
    expect(withDiscount).toContain('Discount');
    expect(withDiscount).toContain('15,990.00');
  });

  it('carries no VAT or supervision — a BOQ prices the works only', async () => {
    const html = await buildBoqHtml(detail(), opts);
    expect(html).not.toMatch(/VAT|ضريبة|Supervision|إشراف/);
  });

  it('escapes markup in studio-controlled text', async () => {
    const html = await buildBoqHtml(detail({ title: '<script>x</script>' }), opts);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
