import { describe, expect, it, vi } from 'vitest';

import type { ContractDetail } from '@/lib/contracts/queries-detail';

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

const { buildContractHtml } = await import('./contract-template');

function detail(): ContractDetail {
  return {
    id: 'k1',
    number: 4,
    titleAr: 'عقد تشطيب',
    titleEn: 'Fit-out contract',
    status: 'signed',
    currency: 'EGP',
    sourceProposalId: 'p1',
    signatureDate: '2026-03-10',
    startDate: '2026-03-15',
    endDate: '2026-06-15',
    createdAt: '2026-03-10T00:00:00.000Z',
    clientId: 'c1',
    projectId: 'j1',
    clientNameEn: 'Acme Interiors',
    clientNameAr: 'أكمي',
    retentionPct: '5',
    retentionReleaseTermsAr: null,
    retentionReleaseTermsEn: null,
    advancePct: '25',
    advanceRecoveryMethod: 'pro_rata',
    paymentTermsDays: 30,
    paymentScheduleMode: 'milestone',
    penaltyAr: null,
    penaltyEn: null,
    defectsLiabilityDays: null,
    scopeInclusionsAr: null,
    scopeInclusionsEn: null,
    scopeExclusionsAr: null,
    scopeExclusionsEn: null,
    termsAr: null,
    termsEn: null,
    discountPct: '0',
    taxRate: '14',
    supervisionPct: '10',
    subtotal: '1000',
    discountAmount: '0',
    taxableBase: '1000',
    taxAmount: '140',
    supervisionAmount: '100',
    originalValue: '1240',
    revisedValue: '1240',
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

describe('buildContractHtml — direction follows the locale', () => {
  it('renders an Arabic contract RTL', async () => {
    const html = await buildContractHtml(detail(), { ...opts, locale: 'ar-EG' });
    expect(html).toContain('<html lang="ar-EG" dir="rtl">');
    expect(html).toContain('<table dir="rtl">');
    expect(html).toContain('الوصف');
  });

  // The bug this file was added for: English labels were rendering inside an
  // RTL frame, so the title right-aligned and the columns ran Description ->
  // Total right-to-left. Label language and layout direction must agree.
  it('renders an English contract LTR, not RTL', async () => {
    const html = await buildContractHtml(detail(), { ...opts, locale: 'en' });
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
      const html = await buildContractHtml(detail(), { ...opts, locale });
      const dirs = [...html.matchAll(/\bdir="(\w+)"/g)].map((m) => m[1]);
      expect(dirs.length).toBeGreaterThan(0);
      expect(new Set(dirs)).toEqual(new Set([dir]));
    }
  });
});
