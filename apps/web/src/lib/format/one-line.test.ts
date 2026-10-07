import { describe, expect, it } from 'vitest';
import { NAME_MAX_CHARS, TITLE_MAX_CHARS, oneLine } from './one-line';

describe('oneLine', () => {
  it('flattens line breaks and controls into single spaces', () => {
    expect(oneLine('Villa\r\nBcc: x@example.com', 80)).toBe('Villa Bcc: x@example.com');
    expect(oneLine(' a\t\u0000b\u2028c  ', 80)).toBe('a b c');
  });

  it('drops bidi overrides and zero-width characters', () => {
    expect(oneLine('\u202eVilla\u202c\u200b Kitchen', 80)).toBe('Villa Kitchen');
  });

  it('caps at the limit with an ellipsis, by code point', () => {
    const long = 'ف'.repeat(200);
    const capped = oneLine(long, NAME_MAX_CHARS);
    expect(Array.from(capped)).toHaveLength(NAME_MAX_CHARS);
    expect(capped.endsWith('…')).toBe(true);
    expect(oneLine('😀'.repeat(130), TITLE_MAX_CHARS)).toBe(`${'😀'.repeat(119)}…`);
  });

  it('leaves a short value alone, and null reads as empty', () => {
    expect(oneLine('فيلا التجمع', TITLE_MAX_CHARS)).toBe('فيلا التجمع');
    expect(oneLine(null, 10)).toBe('');
  });
});
