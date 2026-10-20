import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@metra/db';
import { maySeeBilling } from '@/lib/execution/billing/access';
import { mayOpenCostSheet } from '@/lib/execution/cost-sheet/access';
import { mayReadMeasurements } from '@/lib/execution/measurements/access';
import { contractTabsFor, openingContractTab } from './tabs';

// PR A4.3 and A5: who sees which tab of a contract. The execution tabs are an
// execution contract's, each for the roles of its own matrix row: payments and
// the final account for `payments` read, measurements for `site_measurements`
// read, the cost sheet for `margin_pnl` read; the rest of the contract is for
// the roles with `contracts_generate` read. A project manager or an accountant
// bills, measures and reads costs without opening the contract itself.

const accessOf = (role: MemberRole) => ({
  seeContract: can(role, 'contracts_generate', 'read'),
  seeBilling: maySeeBilling(role),
  seeMeasurements: mayReadMeasurements(role),
  seeCostSheet: mayOpenCostSheet(role),
});
const EXECUTION = { sourceBoqId: 'b-1' };
const PROPOSAL = { sourceBoqId: null };

describe('contractTabsFor', () => {
  it('gives the owner and the admin every tab of an execution contract, the viewer all but the cost sheet', () => {
    const every = ['overview', 'schedule', 'payments', 'final_account', 'measurements', 'cost_sheet', 'variations'];
    for (const role of ['owner', 'admin'] as const) expect(contractTabsFor(EXECUTION, accessOf(role)), role).toEqual(every);
    expect(contractTabsFor(EXECUTION, accessOf('viewer'))).toEqual(every.filter((tab) => tab !== 'cost_sheet'));
  });

  it('gives the project manager and the accountant the execution tabs alone, and nothing of a proposal contract', () => {
    for (const role of ['project_manager', 'accountant'] as const) {
      expect(contractTabsFor(EXECUTION, accessOf(role)), role).toEqual(['payments', 'final_account', 'measurements', 'cost_sheet']);
      expect(contractTabsFor(PROPOSAL, accessOf(role)), role).toEqual([]);
    }
  });

  it('gives the site engineer the measurements alone (they open the measurements page, not this one)', () => {
    expect(contractTabsFor(EXECUTION, accessOf('site_engineer'))).toEqual(['measurements']);
  });

  it('a proposal contract has none of the execution tabs', () => {
    expect(contractTabsFor(PROPOSAL, accessOf('owner'))).toEqual(['overview', 'variations']);
  });

  it('opens on the asked tab when this person has it, else on their first', () => {
    expect(openingContractTab('payments', ['overview', 'payments'])).toBe('payments');
    expect(openingContractTab('final_account', ['payments', 'final_account'])).toBe('final_account');
    expect(openingContractTab('schedule', ['payments'])).toBe('payments');
    expect(openingContractTab(['payments'], ['overview', 'payments'])).toBe('overview');
  });
});
