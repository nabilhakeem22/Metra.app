import { describe, expect, it, vi } from 'vitest';

import type { ProposalDetail } from '@/lib/proposals/queries/detail';

// ./template reaches @/lib/cf/context, which is `server-only` and calls
// getCloudflareContext(). Stub both so the builder runs in Node: fontFaceCss()
// degrades to '' off-platform, which is exactly the shape these tests want —
// the markup, not the embedded fonts.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => false,
  cfEnv: () => {
    throw new Error('getCloudflareContext() called off-platform');
  },
}));

const { buildProposalHtml } = await import('./proposal-template');

function detail(): ProposalDetail {
  return {
    id: 'p1',
    number: 7,
    titleAr: 'تشطيب مكتب',
    titleEn: 'Office fit-out',
    status: 'draft',
    currency: 'EGP',
    issueDate: '2026-03-01',
    expiryDate: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    version: 1,
    supersedesId: null,
    clientId: 'c1',
    projectId: 'j1',
    clientNameEn: 'Acme Interiors',
    clientNameAr: 'أكمي',
    discountPct: '0',
    taxRate: '14',
    supervisionPct: '10',
    subtotal: '1000',
    discountAmount: '0',
    taxableBase: '1000',
    taxAmount: '140',
    supervisionAmount: '100',
    total: '1240',
    notesAr: null,
    notesEn: null,
    termsAr: null,
    termsEn: null,
    sections: [
      {
        id: 's1',
        titleAr: 'أعمال جبس',
        titleEn: 'Gypsum works',
        sortOrder: 0,
        sectionSubtotal: '1000',
        lines: [
          {
            id: 'l1',
            descriptionAr: 'سقف معلق',
            descriptionEn: 'Suspended ceiling',
            costItemId: null,
            qty: '10',
            unit: 'm2',
            unitPrice: '100',
            discountPct: '0',
            lineTotal: '1000',
            sortOrder: 0,
          },
        ],
      },
    ],
  };
}

const opts = {
  variant: 'client' as const,
  orgNameAr: 'ميترا',
  orgNameEn: 'Metra',
};

describe('buildProposalHtml — direction follows the locale', () => {
  it('renders an Arabic proposal RTL', async () => {
    const html = await buildProposalHtml(detail(), { ...opts, locale: 'ar-EG' });
    expect(html).toContain('<html lang="ar-EG" dir="rtl">');
    expect(html).toContain('<table dir="rtl">');
    expect(html).toContain('الوصف');
  });

  // The bug this file was added for: English labels were rendering inside an
  // RTL frame, so the title right-aligned and the columns ran Description ->
  // Total right-to-left. Label language and layout direction must agree.
  it('renders an English proposal LTR, not RTL', async () => {
    const html = await buildProposalHtml(detail(), { ...opts, locale: 'en' });
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<table dir="ltr">');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain('Description');
  });

  it('leaves no direction hardcoded — every dir attribute agrees with the locale', async () => {
    for (const [locale, dir] of [
      ['ar-EG', 'rtl'],
      ['en', 'ltr'],
    ] as const) {
      const html = await buildProposalHtml(detail(), { ...opts, locale });
      const dirs = [...html.matchAll(/\bdir="(\w+)"/g)].map((m) => m[1]);
      expect(dirs.length).toBeGreaterThan(0);
      expect(new Set(dirs)).toEqual(new Set([dir]));
    }
  });
});
