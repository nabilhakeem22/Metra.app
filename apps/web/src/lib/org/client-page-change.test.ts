import { describe, expect, it } from 'vitest';
import { changedFields, maskedChange, maskedValue, type Fingerprint } from './client-page-change';
import { CLIENT_PAGE_FIELDS, type ClientPageDetails } from './client-page-details';

const NONE = Object.fromEntries(CLIENT_PAGE_FIELDS.map((field) => [field, null])) as ClientPageDetails;

/** A stand-in keyed tag: distinct per (field, value), as the HMAC is. */
const tag: Fingerprint = (field, value) => `${field.length.toString(16)}${[...value].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 0xfffffff, 7).toString(16)}`.slice(0, 8);

describe('changedFields', () => {
  it('lists only what differs, in the card order', () => {
    const before = { ...NONE, studioPhone: '01012345678', bankName: 'CIB' };
    const after = { ...before, bankName: 'NBE', bankIban: 'EG380019000500000000263180002' };
    expect(changedFields(before, after)).toEqual(['bankName', 'bankIban']);
    expect(changedFields(before, before)).toEqual([]);
  });
});

describe('maskedValue (F4, S2)', () => {
  it('keeps at most four trailing characters, and never most of a short value', () => {
    expect(maskedValue('bankIban', 'EG380019000500000000263180002')).toBe('••••0002');
    expect(maskedValue('bankAccountNumber', '1234567890')).toBe('••••7890');
    expect(maskedValue('bankAccountNumber', '12345678')).toBe('••••5678');
    expect(maskedValue('bankAccountNumber', '1234567')).toBe('••••567');
    expect(maskedValue('bankAccountNumber', '12345')).toBe('••••5');
    expect(maskedValue('bankAccountNumber', '1234')).toBe('••••');
  });

  it('masks the local part of an InstaPay address and keeps the shared domain', () => {
    expect(maskedValue('instapayAddress', 'secretstudio@instapay')).toBe('••••udio@instapay');
    expect(maskedValue('instapayAddress', 'thief@instapay')).toBe('••••f@instapay');
    expect(maskedValue('instapayAddress', 'ab@ip')).toBe('••••@ip');
    expect(maskedValue('instapayAddress', '01012345678')).toBe('••••5678');
  });

  it('tags every masked value, so two values never read alike and one value always does', () => {
    const studio = maskedValue('instapayAddress', 'studio@instapay', tag);
    const thief = maskedValue('instapayAddress', 'thief@instapay', tag);
    expect(studio).toMatch(/^••••io@instapay #[0-9a-f]{1,8}$/);
    expect(thief).not.toBe(studio);
    expect(maskedValue('instapayAddress', 'studio@instapay', tag)).toBe(studio);
    expect(maskedValue('studioPhone', '01012345678', tag)).not.toBe(maskedValue('studioPhone', '01112345678', tag));
    expect(maskedValue('bankAccountNumber', '1234', tag)).not.toBe(maskedValue('bankAccountNumber', '9876', tag));
  });

  it('with no key configured, masks without a tag', () => {
    expect(maskedValue('studioPhone', '+201012345678', () => null)).toBe('••••5678');
  });

  it('keeps names as typed and null as null', () => {
    expect(maskedValue('bankName', 'البنك الأهلي المصري', tag)).toBe('البنك الأهلي المصري');
    expect(maskedValue('bankAccountHolder', 'Studio 7', tag)).toBe('Studio 7');
    expect(maskedValue('bankIban', null, tag)).toBeNull();
  });
});

describe('maskedChange', () => {
  it('audits the changed fields only, never a full number, and before differs from after', () => {
    const before = { ...NONE, bankName: 'CIB', bankAccountNumber: '1111222233334821', instapayAddress: 'studio@instapay' };
    const after = { ...before, bankAccountNumber: '9999888877771234', instapayAddress: 'thief@instapay' };
    const change = maskedChange(before, after, changedFields(before, after), tag);
    expect(Object.keys(change.after)).toEqual(['instapayAddress', 'bankAccountNumber']);
    expect(change.before.instapayAddress).not.toBe(change.after.instapayAddress);
    expect(JSON.stringify(change)).not.toMatch(/1111222233334821|9999888877771234|studio@|thief@/);
  });
});
