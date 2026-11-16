import { describe, expect, it } from 'vitest';
import { decidesInClientHome, isOpenForDecision } from './home-deciding';
import { contractSourceOf, publicVariationOf } from './public-shape';
import type { VariationTokenDocument } from './public-types';

// H7: the token document as the client's pages read it. The mapping moved out of
// public.ts unchanged, plus `contractSource`; a document from an un-applied
// function keeps today's page (a proposal's, with the decision on /v).

const DOCUMENT = {
  id: 'v-1',
  number: 3,
  status: 'issued',
  title_ar: 'تعديل',
  title_en: 'Change',
  reason_ar: null,
  reason_en: null,
  net_delta: '10000.0000',
  currency: 'EGP',
  contract_number: 7,
  share_expires_at: null,
  org: { name_ar: 'نون', name_en: 'Noon', logo_file_id: null },
  lines: [],
  contract_active: true,
  rejection_channel: 'client',
  tax_rate: '14.0000',
  supervision_pct: '10.0000',
  time_extension_days: 7,
  contract_source: 'boq',
  contract_end_date: '2027-02-28',
  time_extension_days_total: 12,
} as unknown as VariationTokenDocument;

/** A document as the function answered before stage 2 and step B: none of the keys added since. */
const UNAPPLIED = {
  id: 'v-1',
  number: 3,
  status: 'issued',
  title_ar: null,
  title_en: 'Change',
  reason_ar: null,
  reason_en: null,
  net_delta: '10000.0000',
  currency: 'EGP',
  contract_number: 7,
  share_expires_at: null,
  org: { name_ar: null, name_en: 'Noon', logo_file_id: null },
  lines: [],
} as unknown as VariationTokenDocument;

describe('publicVariationOf', () => {
  it('a BOQ order: every field mapped, the snake_case keys gone', () => {
    const { contract_active, rejection_channel, tax_rate, supervision_pct, time_extension_days, contract_source, contract_end_date, time_extension_days_total, ...rest } = DOCUMENT;
    expect(publicVariationOf(DOCUMENT)).toEqual({
      ...rest,
      contractActive: contract_active,
      rejectionChannel: rejection_channel,
      contractSource: contract_source,
      charges: { taxRate: tax_rate, supervisionPct: supervision_pct },
      timeExtensionDays: time_extension_days,
      finish: { endDate: contract_end_date, approvedExtensionDays: time_extension_days_total },
    });
  });

  it('a document from an un-applied function: a live proposal-shaped order, today page', () => {
    expect(publicVariationOf(UNAPPLIED)).toMatchObject({
      contractActive: true,
      contractSource: 'proposal',
      rejectionChannel: null,
      charges: null,
      timeExtensionDays: null,
      finish: null,
    });
  });

  it('a proposal contract order carries no breakdown, days or finish, whatever the keys say', () => {
    expect(publicVariationOf({ ...DOCUMENT, contract_source: 'proposal' })).toMatchObject({ contractSource: 'proposal', charges: null, timeExtensionDays: null, finish: null });
  });

  it('malformed rates and days fall back; only an explicit false marks the contract dead', () => {
    expect(publicVariationOf({ ...DOCUMENT, tax_rate: '14%', time_extension_days: 1.5, contract_active: null })).toMatchObject({ charges: null, timeExtensionDays: null, contractActive: true });
    expect(publicVariationOf({ ...DOCUMENT, contract_active: false }).contractActive).toBe(false);
  });
});

describe('contractSourceOf', () => {
  it.each([[undefined], [null], ['BOQ'], ['proposal'], [1]])('%j is a proposal', (value) => {
    expect(contractSourceOf(value)).toBe('proposal');
  });

  it("'boq' is a BOQ", () => expect(contractSourceOf('boq')).toBe('boq'));
});

describe('where a change order is decided', () => {
  it('a BOQ contract order in the home, a proposal contract order on /v', () => {
    expect(decidesInClientHome({ contractSource: 'boq' })).toBe(true);
    expect(decidesInClientHome({ contractSource: 'proposal' })).toBe(false);
  });

  const NOW = Date.parse('2026-11-02T10:00:00.000Z');
  const open = { status: 'issued', contractActive: true, share_expires_at: '2026-11-02T10:00:00.001Z' };

  it('open for a decision: issued, its contract live, inside its window; no end date is no end', () => {
    expect(isOpenForDecision(open, NOW)).toBe(true);
    expect(isOpenForDecision({ ...open, share_expires_at: null }, NOW)).toBe(true);
  });

  it.each([
    ['approved', { ...open, status: 'approved' }],
    ['rejected', { ...open, status: 'rejected' }],
    ['a dead contract', { ...open, contractActive: false }],
    ['exactly at the end of its window, as the SQL reads it', { ...open, share_expires_at: '2026-11-02T10:00:00.000Z' }],
    ['past its window', { ...open, share_expires_at: '2026-11-01T10:00:00.000Z' }],
  ])('not open: %s', (_case, variation) => {
    expect(isOpenForDecision(variation, NOW)).toBe(false);
  });
});
