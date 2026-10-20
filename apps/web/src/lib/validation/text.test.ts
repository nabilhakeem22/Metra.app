import { describe, expect, it } from 'vitest';
import {
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  TOO_LONG,
  clean,
  optionalText,
  countCharacters,
  hasVisibleCharacter,
  visibleText,
} from './text';

// These two shapes replace eleven hand-copied declarations across the domain
// cores. The copies agreed on behaviour, so this suite pins the behaviour they
// agreed on — anything here that changes is a change to what the product accepts.
// Percentages moved with their function to ./percent.test.ts.

describe('clean', () => {
  it('collapses every flavour of absent to null', () => {
    for (const value of [null, undefined, '', '   ', '\t\n ', ' '.trim()]) {
      expect(clean(value)).toBeNull();
    }
  });

  it('trims but otherwise preserves the value', () => {
    expect(clean('  Hassan & Sons  ')).toBe('Hassan & Sons');
    expect(clean('0')).toBe('0');
    expect(clean('  مكتب ميترا ')).toBe('مكتب ميترا');
  });

  it('matches the former proposals `normalizeText` case for case', () => {
    // `lib/proposals/validation.ts` carried a byte-identical second copy of this
    // function under a different name, used at 35 sites. Its whole suite is
    // reproduced here so the merge is provably not a behaviour change.
    expect(clean('  hello  ')).toBe('hello');
    expect(clean('   ')).toBeNull();
    expect(clean('')).toBeNull();
    expect(clean(null)).toBeNull();
    expect(clean(undefined)).toBeNull();
  });
});

describe('optionalText', () => {
  it('behaves like clean for absent and in-range values', () => {
    expect(optionalText(null, MAX_NOTE_CHARS)).toBeNull();
    expect(optionalText('   ', MAX_NOTE_CHARS)).toBeNull();
    expect(optionalText('  note  ', MAX_NOTE_CHARS)).toBe('note');
  });

  it('measures the cap AFTER trimming, so padding never fails a legal value', () => {
    const exactlyAtCap = 'x'.repeat(MAX_LABEL_CHARS);
    expect(optionalText(`   ${exactlyAtCap}   `, MAX_LABEL_CHARS)).toBe(exactlyAtCap);
  });

  it('returns TOO_LONG — not null — one character over the cap', () => {
    // The distinction matters: null would mean "store nothing" and would silently
    // DISCARD what the user typed. TOO_LONG makes the caller fail the whole call.
    expect(optionalText('x'.repeat(MAX_LABEL_CHARS + 1), MAX_LABEL_CHARS)).toBe(TOO_LONG);
    expect(optionalText('x'.repeat(MAX_NOTE_CHARS + 1), MAX_NOTE_CHARS)).toBe(TOO_LONG);
  });

  it('counts CODE POINTS, because left(p_note, 2000) counts characters', () => {
    // An emoji is one character to Postgres and two UTF-16 units to `.length`,
    // so 1,001 of them were refused here while the database would have accepted
    // them. The direction was always safe; the two numbers now mean the same.
    const emoji = String.fromCodePoint(0x1f44d);
    expect(optionalText(emoji.repeat(MAX_LABEL_CHARS), MAX_LABEL_CHARS)).toBe(
      emoji.repeat(MAX_LABEL_CHARS),
    );
    expect(optionalText(emoji.repeat(MAX_LABEL_CHARS + 1), MAX_LABEL_CHARS)).toBe(TOO_LONG);
    // Arabic is one unit per character either way — unaffected, and pinned so.
    expect(optionalText('م'.repeat(MAX_LABEL_CHARS), MAX_LABEL_CHARS)).toHaveLength(
      MAX_LABEL_CHARS,
    );
  });

  it('keeps the note cap aligned with left(p_note, 2000) in the SDFs', () => {
    expect(MAX_NOTE_CHARS).toBe(2000);
    expect(MAX_LABEL_CHARS).toBe(200);
  });
});

describe('countCharacters', () => {
  it('counts CODE POINTS, not UTF-16 units', () => {
    expect(countCharacters('\u{1F9F1}\u{1F9F1}')).toBe(2);
    expect('\u{1F9F1}\u{1F9F1}'.length).toBe(4);
  });

  it('Arabic is one unit per character either way', () => {
    expect(countCharacters('سقف جبسوم')).toBe('سقف جبسوم'.length);
  });

  it('the empty string is zero', () => {
    expect(countCharacters('')).toBe(0);
  });
});

describe('visibleText and hasVisibleCharacter', () => {
  // Invisible fillers that are not Cf/Z: Mn (034F, FE0F), Lo (115F, 1160, 3164,
  // FFA0) and So (2800).
  const FILLERS = ['\u034F', '\uFE0F', '\u3164', '\u2800', '\u115F', '\u1160', '\uFFA0'];
  const FORMAT_MARKS = ['\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\uFEFF', '\u2060', '\u00AD', '\u00A0'];

  it('treats a value made only of invisible characters as absent', () => {
    for (const char of [...FILLERS, ...FORMAT_MARKS]) {
      expect(visibleText(char), JSON.stringify(char)).toBeNull();
      expect(visibleText(` ${char}${char} `), JSON.stringify(char)).toBeNull();
      expect(hasVisibleCharacter(char), JSON.stringify(char)).toBe(false);
    }
    expect(visibleText(FILLERS.join('') + FORMAT_MARKS.join(''))).toBeNull();
  });

  it('keeps real text byte for byte, invisible characters inside it included', () => {
    for (const text of [
      'Hassan',
      '\u0645\u0643\u062A\u0628 \u0645\u064A\u062A\u0631\u0627',
      '\u200F\u0645\u0643\u062A\u0628\u200F',
      '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645',
      'Hassan\u200B',
      'a\u3164b',
      '\u2800dots',
      'e\u034F\u0301',
      '\u2764\uFE0F',
      '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
    ]) {
      expect(visibleText(text), JSON.stringify(text)).toBe(text);
      expect(hasVisibleCharacter(text), JSON.stringify(text)).toBe(true);
    }
  });

  it('keeps the plain collapse of null, undefined and blanks', () => {
    for (const value of [null, undefined, '', '   ']) expect(visibleText(value)).toBeNull();
  });
});
