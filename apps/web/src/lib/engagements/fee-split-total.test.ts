import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import { describe, expect, it, vi } from 'vitest';
import { validateFeeSchedule } from './fee-schedule';
import { summarizeFeeSplit } from './fee-split-total';

// `validateFeeSchedule` is pure; its module also holds the executor-only runner,
// whose `fail` import reaches the server-only mutate stack.
vi.mock('@/lib/actions/mutate', () => ({ fail: vi.fn() }));

type Row = { kind: MilestoneKind; value: string };
const split = (deposit: string, gateB: string, balance: string): Row[] => [
  { kind: 'deposit', value: deposit },
  { kind: 'gate_b', value: gateB },
  { kind: 'balance', value: balance },
];

/** The payload the fee form submits: empty rows omitted, values trimmed. */
function payloadOf(basis: MilestoneBasis, designFee: string, rows: Row[]) {
  return {
    designFee: designFee.trim(),
    milestones: rows
      .filter((row) => row.value.trim() !== '')
      .map((row) => ({ kind: row.kind, basis, value: row.value.trim() })),
  };
}

describe('summarizeFeeSplit', () => {
  it('50/30/20 percent with a fee may submit', () => {
    const summary = summarizeFeeSplit({ basis: 'percent', designFee: '90000', rows: split('50', '30', '20') });
    expect(summary).toMatchObject({ total: '100.0000', target: '100.0000', balanced: true, canSubmit: true });
  });

  it('is held back by an empty fee, an empty deposit, or a total short of 100%', () => {
    expect(summarizeFeeSplit({ basis: 'percent', designFee: '', rows: split('50', '30', '20') }))
      .toMatchObject({ hasFee: false, canSubmit: false });
    expect(summarizeFeeSplit({ basis: 'percent', designFee: '90000', rows: split('', '50', '50') }))
      .toMatchObject({ hasDeposit: false, canSubmit: false });
    expect(summarizeFeeSplit({ basis: 'percent', designFee: '90000', rows: split('50', '30', '10') }))
      .toMatchObject({ total: '90.0000', balanced: false, canSubmit: false });
  });

  it('an amount split must equal the fee to the piastre', () => {
    expect(
      summarizeFeeSplit({ basis: 'amount', designFee: '100000', rows: split('50000', '30000', '20000') }),
    ).toMatchObject({ target: '100000.0000', canSubmit: true });
    expect(
      summarizeFeeSplit({ basis: 'amount', designFee: '100000', rows: split('50000', '30000', '19999.99') }),
    ).toMatchObject({ balanced: false });
    expect(summarizeFeeSplit({ basis: 'amount', designFee: '', rows: split('1', '1', '1') }))
      .toMatchObject({ target: null, balanced: false });
  });

  it('a malformed value (comma decimal, Arabic-Indic digits, negative) unbalances it', () => {
    for (const bad of ['1,5', '٥٠', '-10']) {
      expect(
        summarizeFeeSplit({ basis: 'percent', designFee: '1000', rows: split('50', bad, '50') }).balanced,
      ).toBe(false);
    }
  });
});

describe('canSubmit agrees with validateFeeSchedule', () => {
  const FIXTURES: { basis: MilestoneBasis; designFee: string; rows: Row[] }[] = [
    { basis: 'percent', designFee: '90000', rows: split('50', '30', '20') },
    { basis: 'percent', designFee: '90000', rows: split(' 50 ', '30', '20') },
    { basis: 'percent', designFee: '90000', rows: split('50', '', '50') },
    { basis: 'percent', designFee: '90000', rows: split('33.33', '33.33', '33.34') },
    { basis: 'percent', designFee: '90000', rows: split('50', '30', '10') },
    { basis: 'percent', designFee: '90000', rows: split('', '50', '50') },
    { basis: 'percent', designFee: '0', rows: split('50', '30', '20') },
    { basis: 'percent', designFee: 'abc', rows: split('50', '30', '20') },
    { basis: 'percent', designFee: '90000', rows: split('0', '50', '50') },
    { basis: 'percent', designFee: '90000', rows: split('50', '1,5', '48.5') },
    { basis: 'amount', designFee: '100000', rows: split('50000', '30000', '20000') },
    { basis: 'amount', designFee: '100000', rows: split('50000', '30000', '19999') },
    { basis: 'amount', designFee: '3', rows: split('1', '1', '1') },
    {
      basis: 'percent',
      designFee: '90000',
      rows: [
        { kind: 'deposit', value: '40' },
        { kind: 'gate_a', value: '20' },
        { kind: 'gate_b', value: '20' },
        { kind: 'balance', value: '20' },
      ],
    },
  ];

  it.each(FIXTURES)('$basis $designFee %#', ({ basis, designFee, rows }) => {
    const summary = summarizeFeeSplit({ basis, designFee, rows });
    const server = validateFeeSchedule(payloadOf(basis, designFee, rows));
    expect(summary.canSubmit).toBe(server.ok);
  });
});
