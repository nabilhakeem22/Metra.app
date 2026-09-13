import { describe, expect, it } from 'vitest';
import { allocateSettlements } from './co-settlement';

const co = (id: string, amount: string) => ({ id, amount });

describe('allocateSettlements', () => {
  it('links each change order to the payment that completed its cover', () => {
    expect(
      allocateSettlements(
        [co('co1', '3000'), co('co2', '2000')],
        [co('p1', '3000'), co('p2', '2000')],
        0n,
      ),
    ).toEqual([
      { changeOrderId: 'co1', paymentEventId: 'p1' },
      { changeOrderId: 'co2', paymentEventId: 'p2' },
    ]);
  });

  it('links a change order covered by two partial payments to the SECOND', () => {
    expect(
      allocateSettlements([co('co1', '5000')], [co('p1', '2000'), co('p2', '3000')], 0n),
    ).toEqual([{ changeOrderId: 'co1', paymentEventId: 'p2' }]);
  });

  it('lets one oversized payment settle several change orders', () => {
    expect(
      allocateSettlements(
        [co('co1', '3000'), co('co2', '2000')],
        [co('p1', '10000')],
        0n,
      ),
    ).toEqual([
      { changeOrderId: 'co1', paymentEventId: 'p1' },
      { changeOrderId: 'co2', paymentEventId: 'p1' },
    ]);
  });

  it('drains credit already spent on previously settled change orders first', () => {
    // 5000 paid, but 5000 of it already settled an earlier change order, so the
    // new 3000 change order has nothing behind it.
    expect(
      allocateSettlements([co('co2', '3000')], [co('p1', '5000')], 5000n * 10000n),
    ).toEqual([{ changeOrderId: 'co2', paymentEventId: null }]);
  });

  it('leaves every change order past the exhausted credit unlinked', () => {
    expect(
      allocateSettlements(
        [co('co1', '3000'), co('co2', '2000'), co('co3', '1000')],
        [co('p1', '3000')],
        0n,
      ),
    ).toEqual([
      { changeOrderId: 'co1', paymentEventId: 'p1' },
      { changeOrderId: 'co2', paymentEventId: null },
      { changeOrderId: 'co3', paymentEventId: null },
    ]);
  });

  it('is exact to the piastre and does not settle a one-piastre shortfall', () => {
    expect(
      allocateSettlements([co('co1', '1000.0000')], [co('p1', '999.9999')], 0n),
    ).toEqual([{ changeOrderId: 'co1', paymentEventId: null }]);
    expect(
      allocateSettlements([co('co1', '1000.0000')], [co('p1', '1000.0000')], 0n),
    ).toEqual([{ changeOrderId: 'co1', paymentEventId: 'p1' }]);
  });

  it('allocates nothing when there is nothing raised', () => {
    expect(allocateSettlements([], [co('p1', '5000')], 0n)).toEqual([]);
  });

  it('leaves a change order unlinked when no payment exists at all', () => {
    expect(allocateSettlements([co('co1', '1')], [], 0n)).toEqual([
      { changeOrderId: 'co1', paymentEventId: null },
    ]);
  });
});
