import { describe, expect, it } from 'vitest';
import { UUID_RE, isUuid } from './uuid';

// This check is a SECURITY-relevant pre-flight at most of its 20-odd call sites:
// it stops a malformed id reaching a `::uuid` cast (which raises, turning a coded
// rejection into a 500) and keeps forged ids out of the tokenized client surfaces.
// It used to be declared 22 times; now it is declared once, so it is worth pinning.

describe('isUuid', () => {
  it('accepts a canonical uuid in either case', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(isUuid('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
  });

  it('is total over unknown — no throw on the non-strings call sites used to pass', () => {
    // Every previous call site wrote `UUID_RE.test(x ?? '')` to get this. The
    // migration dropped those fallbacks, so the totality has to hold here.
    for (const value of [null, undefined, 42, {}, [], true, Symbol('x')]) {
      expect(isUuid(value)).toBe(false);
    }
  });

  it('rejects the near-misses that a loose check would let through', () => {
    for (const value of [
      '',
      '   ',
      '3f2504e0-4f89-41d3-9a0c-0305e82c330', // one short
      '3f2504e0-4f89-41d3-9a0c-0305e82c33011', // one long
      '3f2504e04f8941d39a0c0305e82c3301', // no hyphens
      '3f2504e0-4f89-41d3-9a0c_0305e82c3301', // wrong separator
      'g32504e0-4f89-41d3-9a0c-0305e82c3301', // non-hex
      ' 3f2504e0-4f89-41d3-9a0c-0305e82c3301', // leading space
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301 ', // trailing space
    ]) {
      expect(isUuid(value)).toBe(false);
    }
  });

  it('is anchored at both ends — no injection riding alongside a valid uuid', () => {
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301' or 1=1--")).toBe(false);
    expect(isUuid('prefix3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(false);
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301\nsecond-line')).toBe(false);
  });

  it('exposes a regex with no global flag', () => {
    // A `/g` regex carries lastIndex between calls, so alternating inputs would
    // return alternating answers. Pinned because the exported constant is shared.
    expect(UUID_RE.global).toBe(false);
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(UUID_RE.test(id)).toBe(true);
    expect(UUID_RE.test(id)).toBe(true);
  });
});
