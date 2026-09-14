import { describe, expect, it } from 'vitest';
import {
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  TOO_LONG,
  clean,
  normalizePercent,
  optionalText,
} from './text';

// These three shapes replace fourteen hand-copied declarations across the domain
// cores. The copies agreed on behaviour, so this suite pins the behaviour they
// agreed on — anything here that changes is a change to what the product accepts.

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

describe('normalizePercent', () => {
  it('returns the blank value for absent input, defaulting to zero', () => {
    for (const value of [null, undefined, '', '  ']) {
      expect(normalizePercent(value)).toBe('0');
      expect(normalizePercent(value, '12')).toBe('12'); // caller-chosen blank
    }
  });

  it('accepts the decimal percentage strings the forms actually submit', () => {
    expect(normalizePercent('0')).toBe('0');
    expect(normalizePercent('10')).toBe('10');
    expect(normalizePercent('12.5')).toBe('12.5');
    expect(normalizePercent('100')).toBe('100');
    expect(normalizePercent('  7.25  ')).toBe('7.25'); // trimmed, then shape-checked
  });

  it('refuses what Number() would have silently accepted', () => {
    // Every one of these coerces to a finite number in [0,100] under Number(), so
    // a range check alone would let them through to a numeric column.
    expect(Number('1e2')).toBe(100);
    expect(Number('0x1A')).toBe(26);
    expect(Number('')).toBe(0);
    for (const value of ['1e2', '0x1A', '+5', '5%', '1,5', '.5', '5.', 'NaN', 'Infinity']) {
      expect(normalizePercent(value)).toBeNull();
    }
  });

  it('refuses negatives and anything past 100', () => {
    for (const value of ['-1', '100.0001', '101', '1000']) {
      expect(normalizePercent(value)).toBeNull();
    }
  });
});
