import { describe, expect, it } from 'vitest';
import { actorLabel, DISPLAY_NAME_MAX_CHARS, safeDisplayName } from './display-name';

describe('safeDisplayName (S1)', () => {
  it('keeps an ordinary name', () => {
    expect(safeDisplayName('Sara Adel')).toBe('Sara Adel');
    expect(safeDisplayName('نبيل حكيم')).toBe('نبيل حكيم');
  });

  it('puts a multi-line name on one line and drops links', () => {
    expect(safeDisplayName('Nabil\nApproved, no action needed')).toBe('Nabil Approved, no action needed');
    expect(safeDisplayName('Sara https://evil.example/pay www.evil.example')).toBe('Sara');
  });

  it('drops control and format characters', () => {
    const rlo = String.fromCodePoint(0x202e);
    const nul = String.fromCodePoint(0);
    expect(safeDisplayName(`${rlo}Sara${nul}`)).toBe('Sara');
  });

  it(`clips to ${DISPLAY_NAME_MAX_CHARS} characters`, () => {
    const clipped = safeDisplayName('x'.repeat(200))!;
    expect([...clipped]).toHaveLength(DISPLAY_NAME_MAX_CHARS);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('is null when nothing readable is left, or for a non-string', () => {
    expect(safeDisplayName('   ')).toBeNull();
    expect(safeDisplayName('https://evil.example')).toBeNull();
    expect(safeDisplayName(42)).toBeNull();
    expect(safeDisplayName(undefined)).toBeNull();
  });
});

describe('actorLabel', () => {
  it('always shows the verified email, with the name only beside it', () => {
    expect(actorLabel({ name: 'Sara', email: 'sara@studio.test' })).toBe('Sara (sara@studio.test)');
    expect(actorLabel({ name: null, email: 'sara@studio.test' })).toBe('sara@studio.test');
    expect(actorLabel({ name: 'Sara', email: null })).toBeNull();
  });
});
