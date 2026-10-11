import { describe, expect, it } from 'vitest';
import { shapeDelivery } from './delivery-shape';
import { RECEIPTS_MAX_ENTRIES, parseReceipts } from './receipt-rows';

// Round D: the receipts come from the snapshot's own `receipts` list (at most
// 200), never from the 60-entry timeline. Malformed entries are dropped.

const receipt = (kind: string, amount: unknown, at: unknown) => ({ kind, amount, at });

describe('parseReceipts', () => {
  it('keeps the order and the three client fields only', () => {
    expect(
      parseReceipts([
        { ...receipt('gate_a', '20000.0000', '2026-10-02T09:00:00+00:00'), method: 'cash', reference: 'R-1' },
        receipt('deposit', '10000.5000', '2026-10-01T09:00:00Z'),
      ]),
    ).toEqual([
      { kind: 'gate_a', amount: '20000.0000', at: '2026-10-02T09:00:00.000Z' },
      { kind: 'deposit', amount: '10000.5000', at: '2026-10-01T09:00:00.000Z' },
    ]);
  });

  it.each([
    ['an unknown kind', receipt('refund', '1.0000', '2026-10-01T09:00:00Z')],
    ['a zero amount', receipt('deposit', '0.0000', '2026-10-01T09:00:00Z')],
    ['a negative amount', receipt('deposit', '-5.0000', '2026-10-01T09:00:00Z')],
    ['a numeric amount', receipt('deposit', 5, '2026-10-01T09:00:00Z')],
    ['a bad instant', receipt('deposit', '1.0000', 'last week')],
    ['a null hole', null],
    ['a string', 'deposit'],
  ])('drops %s', (_label, entry) => {
    expect(parseReceipts([entry, receipt('balance', '1.0000', '2026-10-01T09:00:00Z')])).toHaveLength(1);
  });

  it('a missing or non-array list is empty; a longer one is cut at the SQL cap', () => {
    expect(parseReceipts(undefined)).toEqual([]);
    expect(parseReceipts({ 0: 'x' })).toEqual([]);
    const many = Array.from({ length: RECEIPTS_MAX_ENTRIES + 5 }, () => receipt('deposit', '1.0000', '2026-10-01T09:00:00Z'));
    expect(parseReceipts(many)).toHaveLength(RECEIPTS_MAX_ENTRIES);
  });
});

describe('the snapshot', () => {
  const base = { id: 'de-1', number: 7, state: 'boq' };

  it('reads receipts apart from the timeline, and the truncation flag only when it is true', () => {
    const delivery = shapeDelivery({
      ...base,
      timeline: [],
      receipts: [receipt('deposit', '10000.0000', '2026-10-01T09:00:00Z')],
      receipts_truncated: true,
    });
    expect(delivery?.receipts).toHaveLength(1);
    expect(delivery?.receiptsTruncated).toBe(true);
    expect(shapeDelivery({ ...base, receipts_truncated: 'true' })?.receiptsTruncated).toBe(false);
    expect(shapeDelivery(base)?.receipts).toEqual([]);
  });
});
