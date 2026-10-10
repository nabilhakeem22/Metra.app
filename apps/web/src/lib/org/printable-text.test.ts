import { describe, expect, it } from 'vitest';
import { strippedText, unprintableReason } from './printable-text';

const cp = (...points: number[]) => String.fromCodePoint(...points);

describe('printable text (F8)', () => {
  it('strips format characters and trims', () => {
    expect(strippedText(` ${cp(0x200f)}CIB${cp(0x61c)} `)).toBe('CIB');
  });

  it('reads letters, digits, punctuation and symbols as printable', () => {
    for (const text of ['CIB', 'بنك مصر', 'مُحَمَّد', '7', '@', '€']) expect(unprintableReason(text), text).toBeNull();
  });

  it('refuses controls and lone surrogates', () => {
    for (const text of [`a${cp(0)}`, `a${cp(0x1f)}`, `a${cp(0x7f)}`, `a${cp(0x85)}`, `a${cp(0x9f)}`, `a${String.fromCharCode(0xdc00)}`]) {
      expect(unprintableReason(text)).toBe('control');
    }
  });

  it('refuses text that draws nothing', () => {
    for (const text of [cp(0x2800), cp(0x115f, 0x1160), cp(0x3164), cp(0xffa0), cp(0x651, 0x64e)]) {
      expect(unprintableReason(text)).toBe('invisible');
    }
  });
});
