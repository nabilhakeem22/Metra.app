import { describe, expect, it } from 'vitest';
import { changedFields, changedPaymentFields, maskedChange, maskedValue } from './client-page-change';
import { CLIENT_PAGE_FIELDS, type ClientPageDetails } from './client-page-details';

const NONE = Object.fromEntries(CLIENT_PAGE_FIELDS.map((field) => [field, null])) as ClientPageDetails;

describe('changedFields', () => {
  it('lists only what differs, in the card order', () => {
    const before = { ...NONE, studioPhone: '01012345678', bankName: 'CIB' };
    const after = { ...before, bankName: 'NBE', bankIban: 'EG380019000500000000263180002' };
    expect(changedFields(before, after)).toEqual(['bankName', 'bankIban']);
    expect(changedFields(before, before)).toEqual([]);
  });

  it('counts a phone change as no payment change', () => {
    expect(changedPaymentFields(['studioPhone', 'studioWhatsapp'])).toEqual([]);
    expect(changedPaymentFields(['studioPhone', 'instapayAddress', 'bankAccountHolder'])).toEqual([
      'instapayAddress',
      'bankAccountHolder',
    ]);
  });
});

describe('maskedValue', () => {
  it('keeps the last four characters of a number and nothing else', () => {
    expect(maskedValue('bankIban', 'EG380019000500000000263180002')).toBe('••••0002');
    expect(maskedValue('bankAccountNumber', '1234567890')).toBe('••••7890');
    expect(maskedValue('instapayAddress', 'studio@instapay')).toBe('••••apay');
    expect(maskedValue('studioPhone', '+201012345678')).toBe('••••5678');
  });

  it('writes nothing short out whole', () => {
    expect(maskedValue('bankAccountNumber', '1234')).toBe('••••');
    expect(maskedValue('instapayAddress', 'abc')).toBe('••••');
  });

  it('keeps names as typed and null as null', () => {
    expect(maskedValue('bankName', 'البنك الأهلي المصري')).toBe('البنك الأهلي المصري');
    expect(maskedValue('bankAccountHolder', 'Studio 7')).toBe('Studio 7');
    expect(maskedValue('bankIban', null)).toBeNull();
  });
});

describe('maskedChange', () => {
  it('audits the changed fields only, and never a full number', () => {
    const before = { ...NONE, bankName: 'CIB', bankAccountNumber: '1111222233334821' };
    const after = { ...before, bankAccountNumber: '9999888877771234' };
    const change = maskedChange(before, after, changedFields(before, after));
    expect(change).toEqual({
      before: { bankAccountNumber: '••••4821' },
      after: { bankAccountNumber: '••••1234' },
    });
    expect(JSON.stringify(change)).not.toMatch(/1111222233334821|9999888877771234/);
  });
});
