import { describe, expect, it } from 'vitest';
import {
  CLIENT_PAGE_FIELDS,
  hasClientPageDetails,
  normalizeClientPageDetails,
  type ClientPageDetails,
  type ClientPageField,
} from './client-page-details';

const BLANK = Object.fromEntries(CLIENT_PAGE_FIELDS.map((field) => [field, ''])) as Record<
  ClientPageField,
  unknown
>;

// Built from code points so the source shows what each one is.
const RLM = String.fromCodePoint(0x200f);
const LRM = String.fromCodePoint(0x200e);
const ALM = String.fromCodePoint(0x061c);
const ZWSP = String.fromCodePoint(0x200b);
const NBSP = String.fromCodePoint(0xa0);
const SOFT_HYPHEN = String.fromCodePoint(0xad);

function saved(input: Partial<Record<ClientPageField, unknown>>): ClientPageDetails {
  const result = normalizeClientPageDetails({ ...BLANK, ...input });
  if (!result.ok) throw new Error(`refused ${result.field}: ${result.code}`);
  return result.value;
}

function refusal(input: Partial<Record<ClientPageField, unknown>>) {
  const result = normalizeClientPageDetails({ ...BLANK, ...input });
  return result.ok ? null : { field: result.field, code: result.code };
}

describe('normalizeClientPageDetails: phones', () => {
  it.each([
    ['010 1234 5678', '01012345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '01012345678'],
    ['۰۱۰۱۲۳۴۵۶۷۸', '01012345678'],
    ['+20 10-1234-5678', '+201012345678'],
    ['0020 (10) 1234.5678', '+201012345678'],
    [`${RLM}+20 10 1234 5678${LRM}`, '+201012345678'],
    ['02 2345 6789', '0223456789'],
  ])('stores the phone %j as %j', (typed, stored) => {
    expect(saved({ studioPhone: typed }).studioPhone).toBe(stored);
  });

  it.each(['12', '123456', '+1234567890123456', '010 1234 567x', '20+1012345678', '++201012345678'])(
    'refuses the phone %j',
    (typed) => {
      expect(refusal({ studioPhone: typed })).toEqual({ field: 'studioPhone', code: 'phone_invalid' });
    },
  );

  it('keeps the 7- and 15-digit boundaries the database allows', () => {
    expect(saved({ studioPhone: '1234567' }).studioPhone).toBe('1234567');
    expect(saved({ studioPhone: '+123456789012345' }).studioPhone).toBe('+123456789012345');
  });

  it('takes a WhatsApp number WhatsApp can place, and refuses a landline', () => {
    expect(saved({ studioWhatsapp: '010 1234 5678' }).studioWhatsapp).toBe('01012345678');
    expect(saved({ studioWhatsapp: '+44 20 7946 0958' }).studioWhatsapp).toBe('+442079460958');
    expect(refusal({ studioWhatsapp: '02 2345 6789' })).toEqual({
      field: 'studioWhatsapp',
      code: 'whatsapp_invalid',
    });
    expect(refusal({ studioWhatsapp: '12' })).toEqual({ field: 'studioWhatsapp', code: 'phone_invalid' });
  });
});

describe('normalizeClientPageDetails: bank and InstaPay', () => {
  it('upper-cases the IBAN, drops its spaces and checks its checksum', () => {
    const value = saved({ bankName: 'CIB', bankIban: 'eg38 0019 0005 0000 0000 2631 8000 2' });
    expect(value.bankIban).toBe('EG380019000500000000263180002');
    expect(refusal({ bankName: 'CIB', bankIban: 'EG38 0019 0005 0000 0000 2631 8000 3' })).toEqual({
      field: 'bankIban',
      code: 'iban_invalid',
    });
    expect(refusal({ bankName: 'CIB', bankIban: 'EG38' })).toEqual({ field: 'bankIban', code: 'iban_invalid' });
  });

  it('asks for the bank name when a number or an IBAN has none', () => {
    expect(refusal({ bankAccountNumber: '1234 5678' })).toEqual({ field: 'bankName', code: 'bank_name_required' });
    expect(refusal({ bankIban: 'EG380019000500000000263180002' })).toEqual({
      field: 'bankName',
      code: 'bank_name_required',
    });
  });

  it('stores an account number without spaces, and refuses one without a digit', () => {
    expect(saved({ bankName: 'NBE', bankAccountNumber: ' 1234 5678-90 ' }).bankAccountNumber).toBe('12345678-90');
    expect(saved({ bankName: 'NBE', bankAccountNumber: '١٢٣٤٥' }).bankAccountNumber).toBe('12345');
    expect(refusal({ bankName: 'NBE', bankAccountNumber: 'ABCD' })).toEqual({
      field: 'bankAccountNumber',
      code: 'invalid',
    });
    expect(refusal({ bankName: 'NBE', bankAccountNumber: '12/34' })).toEqual({
      field: 'bankAccountNumber',
      code: 'invalid',
    });
  });

  it('strips the invisible marks a pasted Arabic name carries, and trims', () => {
    const value = saved({
      bankName: `${RLM}البنك الأهلي المصري${ALM} `,
      bankAccountHolder: `${NBSP}${ZWSP}ستوديو ٧${LRM}`,
      instapayAddress: ` studio${SOFT_HYPHEN}${ZWSP}@instapay `,
    });
    expect(value.bankName).toBe('البنك الأهلي المصري');
    expect(value.bankAccountHolder).toBe('ستوديو ٧');
    expect(value.instapayAddress).toBe('studio@instapay');
  });

  it('strips every Unicode format character this runtime knows', () => {
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
      const character = String.fromCodePoint(codePoint);
      if (!/^\p{Cf}$/u.test(character)) continue;
      expect(saved({ bankName: `CI${character}B` }).bankName, codePoint.toString(16)).toBe('CIB');
    }
  });

  it('holds the database length bounds, in characters', () => {
    expect(saved({ bankName: 'ab' }).bankName).toBe('ab');
    expect(saved({ bankName: 'ب'.repeat(120) }).bankName).toHaveLength(120);
    expect(refusal({ bankName: 'a' })).toEqual({ field: 'bankName', code: 'invalid' });
    expect(refusal({ bankAccountHolder: 'x'.repeat(121) })).toEqual({ field: 'bankAccountHolder', code: 'invalid' });
    expect(saved({ instapayAddress: 'abc' }).instapayAddress).toBe('abc');
    expect(refusal({ instapayAddress: 'ab' })).toEqual({ field: 'instapayAddress', code: 'invalid' });
    // 60 emoji are 120 UTF-16 units but 60 characters: inside the database's 100.
    expect(saved({ instapayAddress: '😀'.repeat(60) }).instapayAddress).toBe('😀'.repeat(60));
  });

  it('reads blank, white space, invisible-only, null and undefined as nothing', () => {
    const value = saved({
      studioPhone: '   ',
      studioWhatsapp: null,
      instapayAddress: undefined,
      bankName: `${ZWSP}${RLM}`,
      bankAccountHolder: NBSP,
    });
    expect(Object.values(value)).toEqual(Array(CLIENT_PAGE_FIELDS.length).fill(null));
  });

  it.each([42, true, {}, ['x'], 'x'.repeat(301)])('refuses %j as invalid, on its field', (bad) => {
    expect(refusal({ bankName: bad })).toEqual({ field: 'bankName', code: 'invalid' });
  });
});

describe('hasClientPageDetails', () => {
  const none = saved({});
  it('needs a way to reach the studio AND a way to pay it', () => {
    expect(hasClientPageDetails(none)).toBe(false);
    expect(hasClientPageDetails({ ...none, studioPhone: '01012345678' })).toBe(false);
    expect(hasClientPageDetails({ ...none, instapayAddress: 'studio@instapay' })).toBe(false);
    expect(hasClientPageDetails({ ...none, studioWhatsapp: '01012345678', bankIban: 'EG38' })).toBe(true);
    expect(hasClientPageDetails({ ...none, studioPhone: '0223456789', bankAccountNumber: '1234' })).toBe(true);
    expect(hasClientPageDetails({ ...none, studioPhone: '0223456789', bankName: 'CIB' })).toBe(false);
  });
});
