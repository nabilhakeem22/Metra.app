import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT, readMoney, readMoneyString, withinMagnitude } from './read';
import type { ReadMoneyOptions } from './read';

// Six parsers collapse into this one. The suite is written as the union of what
// all six accepted, plus the one place they DISAGREED — the comma — where the
// strict reading wins. Everything here is a money value the studio or its client
// will see on a signed document, so each case is a real input, not a fuzz string.

describe('readMoneyString — the shapes every caller shares', () => {
  it('reads a plain decimal and leaves it alone', () => {
    expect(readMoneyString('0')).toBe('0');
    expect(readMoneyString('5')).toBe('5');
    expect(readMoneyString('1200.50')).toBe('1200.50');
  });

  it('clamps past the numeric(18,4) scale instead of letting Postgres round', () => {
    // The app truncates at 4dp and the column rounds, so an unclamped 2.99999
    // previewed as 2.9999 and came back as 3.0000 — one document, two totals.
    expect(readMoneyString('2.99999')).toBe('2.9999');
    expect(readMoneyString('2.9999')).toBe('2.9999');
  });

  it('refuses the shapes Number() would have coerced', () => {
    for (const raw of ['1e17', '1e3', '0x1A', 'abc', '.5', '5.', '12 34', 'EGP 5', '٥']) {
      expect(readMoneyString(raw)).toBeNull();
    }
  });

  it('refuses anything past the magnitude cap', () => {
    expect(readMoneyString(String(MAX_AMOUNT))).toBe(String(MAX_AMOUNT));
    expect(readMoneyString(String(MAX_AMOUNT + 1))).toBeNull();
    expect(readMoneyString('1e17')).toBeNull();
  });

  it('refuses a negative unless the caller allows one', () => {
    expect(readMoneyString('-5')).toBeNull();
    expect(readMoneyString('-5', { allowNegative: true })).toBe('-5');
    expect(readMoneyString(String(-MAX_AMOUNT - 1), { allowNegative: true })).toBeNull();
  });
});

describe('readMoneyString — blank', () => {
  it('refuses an absent value by default', () => {
    // A rate the studio CLEARED is a question for the caller, not a zero.
    for (const raw of [null, undefined, '', '   ']) {
      expect(readMoneyString(raw)).toBeNull();
    }
  });

  it('returns the caller-supplied blank when the field is optional', () => {
    for (const raw of [null, undefined, '', '   ']) {
      expect(readMoneyString(raw, { blank: '0' })).toBe('0');
      expect(readMoneyString(raw, { blank: '14' })).toBe('14'); // e.g. proposal.taxRate
    }
  });

  it('treats a whitespace-only cell as blank when separators are allowed', () => {
    expect(readMoneyString('\u00A0', { allowGroupSeparators: true, blank: '0' })).toBe('0');
  });
});

describe('readMoneyString — separators', () => {
  it('strips the noise a paste out of Excel carries', () => {
    const options = { allowGroupSeparators: true };
    expect(readMoneyString('  1200.50  ', options)).toBe('1200.50');
    expect(readMoneyString('1 200.50', options)).toBe('1200.50');
    expect(readMoneyString('1\u00A0200.50', options)).toBe('1200.50'); // NBSP
    expect(readMoneyString('1\u202F200.50', options)).toBe('1200.50'); // narrow NBSP
    expect(readMoneyString('1\u066C200.50', options)).toBe('1200.50'); // Arabic thousands
  });

  it('accepts a comma ONLY as strict thousands grouping', () => {
    const options = { allowGroupSeparators: true };
    expect(readMoneyString('1,200', options)).toBe('1200');
    expect(readMoneyString('12,345,678.90', options)).toBe('12345678.90');
    expect(readMoneyString('123,456', options)).toBe('123456');
  });

  it('REFUSES an ambiguous comma that three old parsers read as grouping', () => {
    // THE BEHAVIOUR CHANGE IN THIS WAVE. `normMoney`, `readNumericField` and
    // `parseNumericCell` stripped every comma unconditionally, so '1,5' — how a
    // great many people write one and a half — saved as 15. A ten-fold money
    // error on a document the client signs, invisible to every check below it
    // because 15 is a perfectly legal amount. It is now a refusal, which the
    // studio sees as an invalid field rather than never seeing at all.
    const options = { allowGroupSeparators: true };
    for (const raw of ['1,5', '1,2,3', '1.234,56', '1,23', '12,34567', ',500']) {
      expect(readMoneyString(raw, options)).toBeNull();
    }
  });

  it('REFUSES a space that is not in a thousands position', () => {
    // THE REGRESSION THIS CLOSES. Whitespace used to be stripped
    // unconditionally, so '1 5' read as 15 and '1 2 3' as 123 — the same
    // ten-fold error as '1,5', wearing a character nobody looks at. A space now
    // proves it is grouping, exactly as the comma must.
    const options = { allowGroupSeparators: true };
    for (const raw of ['1 5', '1 2 3', '12 00', '1 2345', '1 5', '1 5']) {
      expect(readMoneyString(raw, options)).toBeNull();
    }
    // ...and a real grouped figure still reads, outer whitespace and all.
    expect(readMoneyString('12 000', options)).toBe('12000');
    expect(readMoneyString('  38 000  ', options)).toBe('38000');
    expect(readMoneyString('1 234 567.89', options)).toBe('1234567.89');
  });

  it('refuses TWO different separators in one number', () => {
    // '1 234,567' is a sheet whose own convention is unclear. Guessing is how a
    // rate becomes a thousand times itself.
    const options = { allowGroupSeparators: true };
    expect(readMoneyString('1 234,567', options)).toBeNull();
    expect(readMoneyString('1,234 567', options)).toBeNull();
  });

  it('refuses a comma outright when separators are not allowed', () => {
    expect(readMoneyString('1,200')).toBeNull();
  });
});

describe('readMoneyString — Arabic numerals', () => {
  const options = { allowNegative: true, allowGroupSeparators: true, allowArabicDigits: true };

  it('reads a cell typed on an Arabic keyboard', () => {
    expect(readMoneyString('١٢٣', options)).toBe('123');
    expect(readMoneyString('١٢٫٥', options)).toBe('12.5'); // U+066B decimal
    expect(readMoneyString('١٬٢٠٠', options)).toBe('1200'); // U+066C thousands
    expect(readMoneyString('۱۲۳', options)).toBe('123'); // Persian digits
  });

  it('leaves Arabic digits unreadable on the typed-in form fields', () => {
    // Only the spreadsheet import opts in. §4.1: Metra renders Western numerals,
    // so an Arabic-Indic digit in a form field is a paste accident, not intent.
    expect(readMoneyString('١٢٣', { allowGroupSeparators: true })).toBeNull();
  });
});

describe('readMoney — the reason, not just the refusal', () => {
  it('says too_large for a figure past the cap', () => {
    // The distinction the string form cannot make: 1e13 IS a number, and being
    // told it is not one is both wrong and unactionable.
    expect(readMoney('10000000000000')).toEqual({ ok: false, reason: 'too_large' });
    expect(readMoney(String(MAX_AMOUNT + 1))).toEqual({ ok: false, reason: 'too_large' });
  });

  it('says invalid for everything unreadable', () => {
    expect(readMoney('twelve')).toEqual({ ok: false, reason: 'invalid' });
    expect(readMoney('1,5', { allowGroupSeparators: true })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(readMoney('-5')).toEqual({ ok: false, reason: 'invalid' });
    expect(readMoney('')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('carries the value, and the blank default, when it reads', () => {
    expect(readMoney('1200.5')).toEqual({ ok: true, value: '1200.5' });
    expect(readMoney('', { blank: '0' })).toEqual({ ok: true, value: '0' });
    expect(readMoney(String(MAX_AMOUNT))).toEqual({
      ok: true,
      value: String(MAX_AMOUNT),
    });
  });

  it('is what readMoneyString is made of', () => {
    for (const raw of ['1200.5', 'twelve', '10000000000000', '']) {
      const result = readMoney(raw);
      expect(readMoneyString(raw)).toBe(result.ok ? result.value : null);
    }
  });
});

describe('withinMagnitude', () => {
  it('shape-checks before it measures', () => {
    expect(withinMagnitude('0x10')).toBe(false);
    expect(withinMagnitude('1e2')).toBe(false);
    expect(withinMagnitude('')).toBe(false);
  });

  it('is sign-symmetric at the cap', () => {
    expect(withinMagnitude(String(MAX_AMOUNT))).toBe(true);
    expect(withinMagnitude(String(-MAX_AMOUNT))).toBe(true);
    expect(withinMagnitude(String(MAX_AMOUNT + 1))).toBe(false);
  });
});

// The six parsers this kernel replaced, as the exact option sets their call
// sites now pass. Pinned together because the whole claim of the refactor is
// that these six agree — on the magnitude cap, on the scale clamp, and above all
// on the comma.
describe('the six former parsers', () => {
  const sites: Array<[string, ReadMoneyOptions]> = [
    ['proposals normalizeMoney', { blank: '0' }],
    ['price-book normMoney', { allowGroupSeparators: true, blank: '0' }],
    ['boqs readNumericField', { allowGroupSeparators: true }],
    ['price-book parseMoney', { allowGroupSeparators: true, blank: '0' }],
    [
      'boqs parseNumericCell',
      { allowNegative: true, allowGroupSeparators: true, allowArabicDigits: true },
    ],
    ['variations normalizeSignedMoney', { allowNegative: true, blank: '0' }],
  ];

  it.each(sites)('%s refuses 1e17', (_name, options) => {
    expect(readMoneyString('1e17', options)).toBeNull();
    expect(readMoneyString('100000000000000000', options)).toBeNull();
  });

  it.each(sites)('%s clamps 2.99999 to the stored scale', (_name, options) => {
    expect(readMoneyString('2.99999', options)).toBe('2.9999');
  });

  it.each(sites)('%s refuses the ambiguous comma', (_name, options) => {
    // Three of the six used to read '1,5' as 15.
    expect(readMoneyString('1,5', options)).toBeNull();
  });
});

// Arrived with lib/proposals/validation.test.ts when the proposal validators were
// dissolved into the kernels. The option set below is the EXACT one the proposal
// header and line validators pass, so these cases pin the caller's contract, not
// just the reader's.
const readAmount = (value: string | null | undefined, blank = '0') =>
  readMoneyString(value, { blank });

describe('a proposal money field', () => {
  it('falls back for absent input and rejects a malformed one', () => {
    expect(readAmount(null)).toBe('0');
    expect(readAmount(undefined)).toBe('0');
    expect(readAmount('')).toBe('0');
    expect(readAmount('   ')).toBe('0');
    expect(readAmount(null, '7')).toBe('7');
    expect(readAmount('abc')).toBeNull();
    expect(readAmount('1,000')).toBeNull();
    expect(readAmount('1e3')).toBeNull();
    expect(readAmount('0x10')).toBeNull();
  });

  it('rejects negatives — money here is never signed', () => {
    expect(readAmount('-1')).toBeNull();
    expect(readAmount('-0.5')).toBeNull();
  });

  it('clamps past the 4th decimal so the stored value cannot differ', () => {
    // The bug this closes: the app truncates past 4dp but numeric(18,4) ROUNDS, so
    // '2.99999' previewed as 2.9999 and came back from the database as 3.0000.
    expect(readAmount('2.99999')).toBe('2.9999');
    expect(readAmount('1.00005')).toBe('1.0000');
    // Anything already within scale is returned untouched.
    expect(readAmount('5')).toBe('5');
    expect(readAmount('5.1234')).toBe('5.1234');
  });
});

describe('withinMagnitude — the cases the proposal validators pinned', () => {
  it('accepts up to the cap and rejects beyond it', () => {
    expect(withinMagnitude('0')).toBe(true);
    expect(withinMagnitude(String(MAX_AMOUNT))).toBe(true);
    expect(withinMagnitude(String(MAX_AMOUNT + 1))).toBe(false);
    expect(withinMagnitude('99999999999999999999')).toBe(false);
  });

  it('rejects what bare Number() would have accepted', () => {
    // Number('0x10') is 16 and Number('') is 0 — both would have passed the cap.
    // Unreachable today because every call site normalizes first; pinned so that
    // stays a property of the function rather than of its callers.
    for (const junk of ['0x10', '1e2', '0b11', '', '   ', 'abc']) {
      expect(withinMagnitude(junk)).toBe(false);
    }
  });

  it('still accepts surrounding whitespace, like every other normalizer here', () => {
    // Trimming is deliberate and shared with normalizeMoney: a newline-prefixed
    // '5' is a valid 5, not junk. Pinned so a future tightening does not silently
    // start rejecting pasted input.
    expect(withinMagnitude('\n5')).toBe(true);
    expect(withinMagnitude('  12.5  ')).toBe(true);
  });
});
