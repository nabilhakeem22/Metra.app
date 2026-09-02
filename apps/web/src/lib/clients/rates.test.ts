import { describe, expect, it } from 'vitest';
import { weightedRates } from './rates';

// The Financials tab used to show a percentage somebody typed into the client form.
// It now shows what the client's committed contracts actually say — so this is the
// arithmetic behind two numbers a firm will quote at a client. Worth pinning.

const row = (advancePct: string, retentionPct: string, value: string) => ({
  advancePct,
  retentionPct,
  value,
});

describe('weightedRates', () => {
  it('reports nothing — not zero — when no contract is committed', () => {
    // "No contracts yet" and "0% advance" are different facts. Rendering them the
    // same would tell a firm their client is on a 0% advance.
    expect(weightedRates([])).toEqual({
      advancePct: null,
      retentionPct: null,
      contractCount: 0,
    });
  });

  it('returns a single contract’s rates unchanged', () => {
    expect(weightedRates([row('25', '10', '500000')])).toEqual({
      advancePct: '25.0000',
      retentionPct: '10.0000',
      contractCount: 1,
    });
  });

  it('weights BY VALUE, not by contract count', () => {
    // The case that makes a plain average wrong: 5% on 2,000,000 and 25% on 50,000
    // is not "15% advance" in any sense a firm would recognise.
    //   (5 × 2,000,000 + 25 × 50,000) / 2,050,000 = 11,250,000 / 2,050,000 ≈ 5.4878
    const result = weightedRates([
      row('5', '10', '2000000'),
      row('25', '5', '50000'),
    ]);
    expect(result.advancePct).toBe('5.4878');
    expect(result.contractCount).toBe(2);
    // A plain mean would have said 15% — an order of magnitude out.
    expect(result.advancePct).not.toBe('15.0000');
  });

  it('falls back to a plain mean when every contract is valued at zero', () => {
    // Reachable before values are entered. Must not divide by zero, and must still
    // say something true.
    expect(weightedRates([row('10', '5', '0'), row('20', '15', '0')])).toEqual({
      advancePct: '15.0000',
      retentionPct: '10.0000',
      contractCount: 2,
    });
  });

  it('ignores a zero-valued contract when others carry value', () => {
    // A draft-ish 0-value row must not drag the weighted figure toward its rate.
    const result = weightedRates([row('20', '10', '1000000'), row('99', '99', '0')]);
    expect(result.advancePct).toBe('20.0000');
    expect(result.retentionPct).toBe('10.0000');
  });

  it('is exact at scale 4 — no float drift across many contracts', () => {
    // Three equal-value contracts at 10 / 10 / 10 must be exactly 10, not 9.9999.
    const rows = Array.from({ length: 3 }, () => row('10', '7.5', '333333.3333'));
    expect(weightedRates(rows)).toEqual({
      advancePct: '10.0000',
      retentionPct: '7.5000',
      contractCount: 3,
    });
  });

  it('handles a fractional weighted result by truncating at scale 4', () => {
    // 10% on 1 and 20% on 2  ->  (10 + 40) / 3 = 16.666...  -> 16.6666
    const result = weightedRates([row('10', '0', '1'), row('20', '0', '2')]);
    expect(result.advancePct).toBe('16.6666');
  });
});
