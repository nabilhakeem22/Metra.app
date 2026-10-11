import { afterEach, describe, expect, it, vi } from 'vitest';
import { shapeDelivery } from './delivery-shape';
import { issuanceStamp } from './snapshot-values';

// Round D (AC A6): an issuance instant is echoed back to the consent guard,
// which compares it with the column to the MICROSECOND. It must cross the
// snapshot byte-identical, and no step on its way may go through a JS Date
// (which keeps milliseconds and re-writes the zone).

const MICROSECONDS = '2026-10-10T10:00:00.123456+03:00';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Any use of Date while `run` runs fails the test. */
function withoutDate<T>(run: () => T): T {
  const refuse = () => {
    throw new Error('an issuance stamp went through Date');
  };
  const NoDate = new Proxy(Date, { construct: refuse, apply: refuse, get: refuse });
  vi.stubGlobal('Date', NoDate);
  try {
    return run();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('issuanceStamp', () => {
  it('returns its input byte-identical, and never touches Date', () => {
    expect(withoutDate(() => issuanceStamp(MICROSECONDS))).toBe(MICROSECONDS);
    for (const stamp of ['2026-10-10T07:00:00Z', '2026-10-10T07:00:00.5+00', '2026-10-29T23:30:00.000001-02:30']) {
      expect(withoutDate(() => issuanceStamp(stamp))).toBe(stamp);
    }
  });

  it.each([
    ['a number', 1_760_000_000_000],
    ['null', null],
    ['no zone', '2026-10-10T10:00:00.123456'],
    ['nanoseconds', '2026-10-10T10:00:00.123456789Z'],
    ['a space for the T', '2026-10-10 10:00:00Z'],
    ['a trailing newline', '2026-10-10T10:00:00Z\n'],
    ['too long', `2026-10-10T10:00:00Z${' '.repeat(30)}`],
    ['a date only', '2026-10-10'],
    ['an object', { at: MICROSECONDS }],
  ])('%s is no stamp', (_label, value) => {
    expect(issuanceStamp(value)).toBeNull();
  });
});

describe('the snapshot carries both stamps unchanged', () => {
  const snapshot = {
    id: 'de-1',
    number: 7,
    state: 'final_approval',
    rom: { low: '100000.0000', high: '150000.0000', issued_at: MICROSECONDS },
    renders_issued_at: '2026-10-09T08:15:30.000001+00:00',
  };

  it('rom.issuedAt and rendersIssuedAt are the strings the SDF wrote', () => {
    const delivery = shapeDelivery(snapshot);
    expect(delivery?.rom).toEqual({ low: '100000.0000', high: '150000.0000', issuedAt: MICROSECONDS });
    expect(delivery?.rendersIssuedAt).toBe('2026-10-09T08:15:30.000001+00:00');
  });

  it('a band without a usable stamp is no band; a missing round stamp is null', () => {
    const delivery = shapeDelivery({ ...snapshot, rom: { low: '1.0000', high: '2.0000' }, renders_issued_at: 'yesterday' });
    expect(delivery?.rom).toBeNull();
    expect(delivery?.rendersIssuedAt).toBeNull();
  });
});
