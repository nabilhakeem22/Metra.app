import { describe, expect, test } from 'vitest';
import { isValidEmail, normalizeEmail } from './email';

describe('email', () => {
  test('normalizes for comparison: trimmed, lower case', () => {
    expect(normalizeEmail('  Mona@Firm.COM ')).toBe('mona@firm.com');
  });

  test.each(['mona@firm.com', 'a.b+c@sub.firm.eg'])('%s is an address', (address) => {
    expect(isValidEmail(address)).toBe(true);
  });

  test.each(['mona', 'mona@firm', 'mona @firm.com', '@firm.com', 'mona@.'])('%s is not', (typed) => {
    expect(isValidEmail(typed)).toBe(false);
  });
});
