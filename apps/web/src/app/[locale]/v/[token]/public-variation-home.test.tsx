import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import type { PublicVariation } from '@/lib/variations/public-types';
import { PublicVariationView } from './public-variation';

// H7.2 (AC18): legacy /v of a BOQ contract's order only shows it. Open, with no
// home to lead to: the document and "ask your studio", no name box, no buttons.
// Its window lapsed: the document and "expired". Decided: today's ladder. A
// proposal contract's order still decides here.

const respondToVariation = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ respondToVariation }));

const variationOf = (over: Partial<PublicVariation> = {}): PublicVariation => ({
  id: 'vo-1',
  number: 3,
  status: 'issued',
  title_ar: 'تعديل الجبس',
  title_en: 'Gypsum change',
  reason_ar: null,
  reason_en: null,
  net_delta: '12500.0000',
  currency: 'EGP',
  contract_number: 7,
  share_expires_at: null,
  contractActive: true,
  contractSource: 'boq',
  rejectionChannel: null,
  charges: { taxRate: '14.0000', supervisionPct: '10.0000' },
  timeExtensionDays: null,
  finish: null,
  org: { name_ar: 'ستوديو نون', name_en: 'Noon Studio', logo_file_id: null },
  lines: [{ id: 'l-1', description_ar: 'قواطيع', description_en: 'Partitions', qty: '4.0000', unit: 'm2', unit_price: '3125.0000', discount_pct: '0.0000', line_total: '12500.0000', sort_order: 1 }],
  ...over,
});

beforeEach(() => respondToVariation.mockReset());

describe.each<TestLocale>(['ar-EG', 'en'])('legacy /v of a BOQ order (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, `variations.client.${key}`);
  const studio = locale === 'en' ? 'Noon Studio' : 'ستوديو نون';
  const show = (variation: PublicVariation) => renderWithIntl(<PublicVariationView token="v-raw" variation={variation} />, { locale });

  it('open: the lines and charges still show, then the notice naming the studio; no name box, no buttons', () => {
    show(variationOf());
    expect(screen.getByText(locale === 'en' ? 'Partitions' : 'قواطيع')).toBeTruthy();
    expect(screen.getByText(messageAt(locale, 'portal.changeOrder.charge.total'))).toBeTruthy();
    expect(document.querySelector('[data-decide-in-home]')?.textContent).toBe(at('decideInHome').replaceAll('{studio}', studio));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('its window lapsed: it says the link has expired, and sends nobody to the home', () => {
    show(variationOf({ share_expires_at: '2020-01-01T00:00:00.000Z' }));
    expect(document.querySelector('[data-decide-in-home]')?.textContent).toBe(at('expired'));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each<[string, Partial<PublicVariation>, string]>([
    ['approved', { status: 'approved' }, 'approved'],
    ['rejected by the client', { status: 'rejected', rejectionChannel: 'client' }, 'rejected'],
    ['closed by a termination', { status: 'rejected', rejectionChannel: 'staff', contractActive: false }, 'rejectedOnTermination'],
    ['on a dead contract', { contractActive: false }, 'contractInactive'],
  ])('decided, %s: today ladder', (_case, over, key) => {
    show(variationOf(over));
    expect(screen.getByText(at(key))).toBeTruthy();
    expect(document.querySelector('[data-decide-in-home]')).toBeNull();
  });

  it('a proposal order: the name box and the two buttons, as before', () => {
    show(variationOf({ contractSource: 'proposal', charges: null }));
    expect(screen.getByLabelText(at('nameLabel'))).toBeTruthy();
    expect(screen.getByRole('button', { name: at('approve') })).toBeTruthy();
    expect(screen.getByRole('button', { name: at('reject') })).toBeTruthy();
    expect(document.querySelector('[data-decide-in-home]')).toBeNull();
  });
});
