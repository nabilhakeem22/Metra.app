import { describe, expect, it } from 'vitest';
import {
  CLIENT_PAGE_FIELDS,
  detailsAfter,
  hasClientPageDetails,
  normalizeClientPageChanges,
  type ClientPageDetails,
  type ClientPageField,
} from './client-page-details';

// Built from code points so the source shows what each one is.
const RLM = String.fromCodePoint(0x200f);
const LRM = String.fromCodePoint(0x200e);
const ALM = String.fromCodePoint(0x061c);
const ZWSP = String.fromCodePoint(0x200b);
const NBSP = String.fromCodePoint(0xa0);
const SOFT_HYPHEN = String.fromCodePoint(0xad);

const NONE = Object.fromEntries(CLIENT_PAGE_FIELDS.map((field) => [field, null])) as ClientPageDetails;

function saved(input: Partial<Record<ClientPageField, unknown>>): Partial<ClientPageDetails> {
  const result = normalizeClientPageChanges(input);
  if (!result.ok) throw new Error(`refused ${String(result.field)}: ${result.code}`);
  return result.value;
}

function refusal(input: unknown) {
  const result = normalizeClientPageChanges(input);
  return result.ok ? null : { field: result.field, code: result.code };
}

describe('normalizeClientPageChanges: a save is a set of changes (F1)', () => {
  it('normalises only the fields sent; a missing key is not a change', () => {
    expect(saved({ studioPhone: '010 1234 5678' })).toEqual({ studioPhone: '01012345678' });
    expect(saved({})).toEqual({});
  });

  it('clears a field only on an explicit null or a blank value', () => {
    expect(saved({ bankIban: null, instapayAddress: '   ', bankName: `${ZWSP}${RLM}` })).toEqual({
      bankIban: null,
      instapayAddress: null,
      bankName: null,
    });
  });

  it.each([null, undefined, [], ['studioPhone'], 'x', 42])('refuses %j as a whole, naming no field', (input) => {
    expect(refusal(input)).toEqual({ field: null, code: 'invalid' });
  });

  it('refuses a key that is not a field', () => {
    expect(refusal({ studioPhone: '01012345678', bankBalance: '9' })).toEqual({ field: null, code: 'invalid' });
  });

  it.each([42, true, {}, ['x'], undefined, 'x'.repeat(301)])('refuses %j on its field', (bad) => {
    expect(refusal({ bankName: bad })).toEqual({ field: 'bankName', code: 'invalid' });
  });
});

describe('normalizeClientPageChanges: phones dial (F2)', () => {
  it.each([
    ['010 1234 5678', '01012345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '01012345678'],
    ['۰۱۰۱۲۳۴۵۶۷۸', '01012345678'],
    ['1012345678', '01012345678'],
    ['02 2345 6789', '0223456789'],
    ['040 123 4567', '0401234567'],
    ['+20 10-1234-5678', '+201012345678'],
    ['+20 (0)10 1234 5678', '+201012345678'],
    ['+20 010 1234 5678', '+201012345678'],
    ['00 20 0 10 1234 5678', '+201012345678'],
    ['+0020 10 1234 5678', '+201012345678'],
    ['0020 (10) 1234.5678', '+201012345678'],
    [`${RLM}+20 10 1234 5678${LRM}`, '+201012345678'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('stores the phone %j as %j, in both fields where WhatsApp can place it', (typed, stored) => {
    expect(saved({ studioPhone: typed }).studioPhone).toBe(stored);
  });

  it.each(['12', '123456', '1234567', '+0000000', '+1234567890123456', '010 1234 567x', '20+1012345678', '++201012345678', '19999'])(
    'refuses the implausible phone %j',
    (typed) => {
      expect(refusal({ studioPhone: typed })).toEqual({ field: 'studioPhone', code: 'phone_invalid' });
      expect(refusal({ studioWhatsapp: typed })).toEqual({ field: 'studioWhatsapp', code: 'phone_invalid' });
    },
  );

  it('the same paste reads the same in either field', () => {
    for (const typed of ['+0020 10 1234 5678', '+20 (0)10 1234 5678', '010 1234 5678']) {
      const value = saved({ studioPhone: typed, studioWhatsapp: typed });
      expect(value.studioWhatsapp).toBe(value.studioPhone);
    }
  });

  it('WhatsApp refuses a landline: wa.me could never open it', () => {
    expect(refusal({ studioWhatsapp: '02 2345 6789' })).toEqual({ field: 'studioWhatsapp', code: 'whatsapp_invalid' });
  });
});

describe('normalizeClientPageChanges: bank and InstaPay', () => {
  it('upper-cases the IBAN, drops its spaces and checks its checksum', () => {
    expect(saved({ bankIban: 'eg38 0019 0005 0000 0000 2631 8000 2' }).bankIban).toBe('EG380019000500000000263180002');
    expect(refusal({ bankIban: 'EG38 0019 0005 0000 0000 2631 8000 3' })).toEqual({ field: 'bankIban', code: 'iban_invalid' });
    expect(refusal({ bankIban: 'EG38' })).toEqual({ field: 'bankIban', code: 'iban_invalid' });
  });

  it('stores an account number without spaces, and refuses one without a digit', () => {
    expect(saved({ bankAccountNumber: ' 1234 5678-90 ' }).bankAccountNumber).toBe('12345678-90');
    expect(saved({ bankAccountNumber: '١٢٣٤٥' }).bankAccountNumber).toBe('12345');
    expect(refusal({ bankAccountNumber: 'ABCD' })).toEqual({ field: 'bankAccountNumber', code: 'invalid' });
    expect(refusal({ bankAccountNumber: '12/34' })).toEqual({ field: 'bankAccountNumber', code: 'invalid' });
  });

  it('strips the invisible marks a pasted Arabic name carries, and trims', () => {
    const value = saved({
      bankName: `${RLM}البنك الأهلي المصري${ALM} `,
      bankAccountHolder: `${NBSP}${ZWSP}ستوديو ٧${LRM}`,
      instapayAddress: ` studio${SOFT_HYPHEN}${ZWSP}@instapay `,
    });
    expect(value).toEqual({
      bankName: 'البنك الأهلي المصري',
      bankAccountHolder: 'ستوديو ٧',
      instapayAddress: 'studio@instapay',
    });
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
    expect(saved({ instapayAddress: '😀'.repeat(60) }).instapayAddress).toBe('😀'.repeat(60));
  });
});

describe('normalizeClientPageChanges: printable text only (F8)', () => {
  const cp = (...points: number[]) => String.fromCodePoint(...points);
  it.each([
    ['NUL', `CIB${cp(0)}`],
    ['a C0 control', `ab${cp(1)}`],
    ['a tab inside', `ab${cp(9)}cd`],
    ['DEL', `ab${cp(0x7f)}`],
    ['NEL only', cp(0x85, 0x85, 0x85)],
    ['a C1 control', `ab${cp(0x9b)}`],
    ['a lone surrogate', `a${String.fromCharCode(0xd800)}b`],
    ['Braille blanks', cp(0x2800, 0x2800)],
    ['Hangul fillers', cp(0x115f, 0x115f)],
    ['halfwidth Hangul fillers', cp(0xffa0, 0xffa0, 0xffa0)],
    ['a combining mark on its own', cp(0x651, 0x651, 0x651)],
  ])('refuses %s, with a field error', (_label, value) => {
    for (const field of ['bankName', 'bankAccountHolder', 'instapayAddress'] as const) {
      expect(refusal({ [field]: value }), field).toEqual({ field, code: 'invalid' });
    }
  });

  it('keeps Arabic with its marks', () => {
    expect(saved({ bankAccountHolder: 'مُحَمَّد علي' }).bankAccountHolder).toBe('مُحَمَّد علي');
  });
});

describe('detailsAfter', () => {
  it('applies the changes over what is stored, leaving the rest alone', () => {
    const stored = { ...NONE, bankName: 'CIB', bankAccountNumber: '1111222233334444' };
    expect(detailsAfter(stored, { studioPhone: '01112345678' })).toEqual({
      ok: true,
      value: { ...stored, studioPhone: '01112345678' },
    });
  });

  it('asks for the bank name when a number or an IBAN would be left without one', () => {
    expect(detailsAfter(NONE, { bankAccountNumber: '12345678' })).toEqual({
      ok: false,
      field: 'bankName',
      code: 'bank_name_required',
    });
    const stored = { ...NONE, bankName: 'CIB', bankIban: 'EG380019000500000000263180002' };
    expect(detailsAfter(stored, { bankName: null })).toMatchObject({ ok: false, field: 'bankName' });
  });
});

describe('hasClientPageDetails', () => {
  it('needs a way to reach the studio AND a way to pay it', () => {
    expect(hasClientPageDetails(NONE)).toBe(false);
    expect(hasClientPageDetails({ ...NONE, studioPhone: '01012345678' })).toBe(false);
    expect(hasClientPageDetails({ ...NONE, instapayAddress: 'studio@instapay' })).toBe(false);
    expect(hasClientPageDetails({ ...NONE, studioWhatsapp: '01012345678', bankIban: 'EG38' })).toBe(true);
    expect(hasClientPageDetails({ ...NONE, studioPhone: '0223456789', bankAccountNumber: '1234' })).toBe(true);
    expect(hasClientPageDetails({ ...NONE, studioPhone: '0223456789', bankName: 'CIB' })).toBe(false);
  });
});
