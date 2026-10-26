import { describe, expect, it } from 'vitest';
import type { ContractPageDetail } from '@/lib/contracts/queries';
import { contractPagePayload } from './page-payload';

// A4 security S1: a role that reads only the payments (project manager,
// accountant) gets the slim header in the page's flight data, and none of the
// contract: no client, no terms, no scope, no penalty, no money. The project
// manager also opens the change-order register (H7.3 F1), and with it gets the
// two rates its charges are worked out with, nothing else.

const DETAIL: ContractPageDetail = {
  id: 'c-1',
  number: 7,
  titleAr: 'عقد',
  titleEn: 'Villa fit-out',
  status: 'signed',
  currency: 'EGP',
  sourceProposalId: null,
  sourceBoqId: 'b-1',
  signatureDate: null,
  startDate: '2026-11-01',
  endDate: '2027-03-01',
  createdAt: '2026-10-20T08:00:00.000Z',
  clientId: 'client-secret-id',
  projectId: 'project-secret-id',
  clientNameEn: 'Client Secret Name',
  clientNameAr: 'اسم العميل السري',
  retentionPct: '5.0000',
  retentionReleaseTermsAr: 'شروط الضمان',
  retentionReleaseTermsEn: 'Retention terms',
  advancePct: '10.0000',
  advanceRecoveryMethod: 'pro_rata',
  paymentTermsDays: 30,
  paymentScheduleMode: 'milestones',
  penaltyAr: 'غرامة',
  penaltyEn: 'Penalty clause',
  defectsLiabilityDays: 365,
  scopeInclusionsAr: 'يشمل',
  scopeInclusionsEn: 'Scope inclusions',
  scopeExclusionsAr: 'لا يشمل',
  scopeExclusionsEn: 'Scope exclusions',
  termsAr: 'الشروط',
  termsEn: 'Terms and conditions',
  discountPct: '2.0000',
  taxRate: '14.0000',
  supervisionPct: '10.0000',
  subtotal: '100000.0000',
  discountAmount: '2000.0000',
  taxableBase: '98000.0000',
  taxAmount: '13720.0000',
  supervisionAmount: '9800.0000',
  originalValue: '121520.0000',
  revisedValue: '121520.0000',
  approvedExtensionDays: 0,
  totalCost: '70000.0000',
  totalMargin: '28000.0000',
  signed: { on: '2026-10-20', via: 'paper' },
};

const HEADER_KEYS = ['createdAt', 'id', 'number', 'sourceBoqId', 'status', 'titleAr', 'titleEn'];
const CONTRACT_ONLY_KEYS = Object.keys(DETAIL).filter((key) => !HEADER_KEYS.includes(key));

/** What is serialised into the page: no key and no value of the contract's own fields but `allowed`. */
function expectNothingOfTheContractBut(payload: ReturnType<typeof contractPagePayload>, allowed: readonly string[]) {
  const serialised = JSON.stringify(payload);
  const keysOf = (value: unknown): string[] =>
    typeof value === 'object' && value !== null ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]) : [];
  const keys = keysOf(JSON.parse(serialised));
  const hidden = CONTRACT_ONLY_KEYS.filter((key) => !allowed.includes(key));
  for (const key of hidden) expect(keys, key).not.toContain(key);
  const shown = [...Object.values(payload.header), ...allowed.map((key) => DETAIL[key as keyof ContractPageDetail])];
  for (const key of hidden) {
    const value = DETAIL[key as keyof ContractPageDetail];
    if (typeof value === 'string' && !shown.includes(value)) expect(serialised, key).not.toContain(value);
  }
}

describe('contractPagePayload', () => {
  it('gives a payments-only role (the accountant) the slim header and nothing of the contract', () => {
    const payload = contractPagePayload(DETAIL, { seeContract: false, seeRegister: false });
    expect(payload.detail).toBeNull();
    expect(payload.variationChargeRates).toBeNull();
    expect(Object.keys(payload.header).sort()).toEqual(HEADER_KEYS);
    expectNothingOfTheContractBut(payload, []);
  });

  it('gives the project manager, who opens the change-order register, its two charge rates and nothing more (H7.3 F1)', () => {
    const payload = contractPagePayload(DETAIL, { seeContract: false, seeRegister: true });
    expect(payload.detail).toBeNull();
    expect(payload.variationChargeRates).toEqual({ taxRate: '14.0000', supervisionPct: '10.0000' });
    expect(Object.keys(payload.header).sort()).toEqual(HEADER_KEYS);
    expectNothingOfTheContractBut(payload, ['taxRate', 'supervisionPct']);
  });

  it('gives no charge rates on a proposal contract: its register shows the net change alone', () => {
    const payload = contractPagePayload({ ...DETAIL, sourceBoqId: null }, { seeContract: false, seeRegister: true });
    expect(payload.variationChargeRates).toBeNull();
    expectNothingOfTheContractBut(payload, []);
  });

  it('gives a role that reads the contract the whole detail', () => {
    const payload = contractPagePayload(DETAIL, { seeContract: true, seeRegister: true });
    expect(payload.detail).toBe(DETAIL);
    expect(payload.variationChargeRates).toEqual({ taxRate: '14.0000', supervisionPct: '10.0000' });
    expect(payload.header).toEqual({
      id: 'c-1',
      number: 7,
      titleAr: 'عقد',
      titleEn: 'Villa fit-out',
      status: 'signed',
      sourceBoqId: 'b-1',
      createdAt: '2026-10-20T08:00:00.000Z',
    });
  });
});
