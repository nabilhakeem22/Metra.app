import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/can';
import { MEMBER_ROLES, type MemberRole } from '@/lib/permissions/roles';
import { maySeeBilling } from '@/lib/execution/billing/access';
import { mayOpenCostSheet } from '@/lib/execution/cost-sheet/access';
import { mayReadCostEntries } from '@/lib/execution/costs/access';
import { mayReadMeasurements } from '@/lib/execution/measurements/access';
import { mayRecordVariationDecisionOnPaper } from '@/lib/variations/paper-access';
import { contractTabsFor, openingContractTab, type ContractTab } from './tabs';

// PR A4.3, B3 and A5: who sees which tab of a contract. The execution tabs are
// an execution contract's, each for the roles of its own matrix row: payments
// and the final account for `payments` read, measurements for
// `site_measurements` read, the cost sheet for `margin_pnl` read, and the costs
// for the roles that read both the contract and its costs; the rest of the
// contract is for the roles with `contracts_generate` read. A project manager
// or an accountant bills, measures and reads costs without opening the contract
// itself, and records costs on the costs page (./costs/page.tsx). The change
// orders are also for the roles that record a client's paper answer to one
// (H7.3 F1): the project manager too.

const accessOf = (role: MemberRole) => ({
  seeContract: can(role, 'contracts_generate', 'read'),
  seeBilling: maySeeBilling(role),
  seeMeasurements: mayReadMeasurements(role),
  readsCosts: mayReadCostEntries(role),
  seeCostSheet: mayOpenCostSheet(role),
  decidesVariationsOnPaper: mayRecordVariationDecisionOnPaper(role),
});
const EXECUTION = { sourceBoqId: 'b-1' };
const PROPOSAL = { sourceBoqId: null };

describe('contractTabsFor', () => {
  it('gives the owner and the admin every tab of an execution contract, the viewer all but the costs and the cost sheet', () => {
    const every = ['overview', 'schedule', 'payments', 'final_account', 'measurements', 'costs', 'cost_sheet', 'variations'];
    for (const role of ['owner', 'admin'] as const) expect(contractTabsFor(EXECUTION, accessOf(role)), role).toEqual(every);
    expect(contractTabsFor(EXECUTION, accessOf('viewer'))).toEqual(every.filter((tab) => tab !== 'costs' && tab !== 'cost_sheet'));
  });

  it('gives the accountant the execution tabs alone, all but the costs, and nothing of a proposal contract', () => {
    expect(contractTabsFor(EXECUTION, accessOf('accountant'))).toEqual(['payments', 'final_account', 'measurements', 'cost_sheet']);
    expect(contractTabsFor(PROPOSAL, accessOf('accountant'))).toEqual([]);
  });

  it('gives the project manager the execution tabs but the costs, and the change orders on any contract: he records paper answers there (H7.3 F1)', () => {
    expect(contractTabsFor(EXECUTION, accessOf('project_manager'))).toEqual(['payments', 'final_account', 'measurements', 'cost_sheet', 'variations']);
    expect(contractTabsFor(PROPOSAL, accessOf('project_manager'))).toEqual(['variations']);
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
    expect(openingContractTab('costs', ['overview', 'payments', 'costs'])).toBe('costs');
    expect(openingContractTab('schedule', ['payments'])).toBe('payments');
    expect(openingContractTab(['payments'], ['overview', 'payments'])).toBe('overview');
  });
});

// Every role of the matrix against every tab and page, so a new role or a moved
// grant fails here until someone says what it sees. The contract page answers
// 404 unless the role reads the contract or its payments AND has a tab on this
// contract (the two notFound() calls in page.tsx); the costs page is gated on
// reading costs alone (./costs/page.tsx), the measurements page on reading
// measurements alone (./measurements/page.tsx).
describe('every role against every contract tab and page', () => {
  interface Seen {
    execution: ContractTab[];
    proposal: ContractTab[];
    contractPage: boolean;
    costsPage: boolean;
    measurementsPage: boolean;
  }
  const ALL: ContractTab[] = ['overview', 'schedule', 'payments', 'final_account', 'measurements', 'costs', 'cost_sheet', 'variations'];
  const MATRIX: Record<MemberRole, Seen> = {
    owner: { execution: ALL, proposal: ['overview', 'variations'], contractPage: true, costsPage: true, measurementsPage: true },
    admin: { execution: ALL, proposal: ['overview', 'variations'], contractPage: true, costsPage: true, measurementsPage: true },
    project_manager: {
      execution: ['payments', 'final_account', 'measurements', 'cost_sheet', 'variations'],
      proposal: ['variations'],
      contractPage: true,
      costsPage: true,
      measurementsPage: true,
    },
    site_engineer: { execution: ['measurements'], proposal: [], contractPage: false, costsPage: true, measurementsPage: true },
    accountant: {
      execution: ['payments', 'final_account', 'measurements', 'cost_sheet'],
      proposal: [],
      contractPage: true,
      costsPage: true,
      measurementsPage: true,
    },
    client: { execution: [], proposal: [], contractPage: false, costsPage: false, measurementsPage: false },
    viewer: {
      execution: ['overview', 'schedule', 'payments', 'final_account', 'measurements', 'variations'],
      proposal: ['overview', 'variations'],
      contractPage: true,
      costsPage: false,
      measurementsPage: true,
    },
  };

  const opensContractPage = (role: MemberRole, contract: { sourceBoqId: string | null }) => {
    const access = accessOf(role);
    return (access.seeContract || access.seeBilling) && contractTabsFor(contract, access).length > 0;
  };

  it('covers exactly the roles of the matrix', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...MEMBER_ROLES].sort());
  });

  it.each(MEMBER_ROLES)('%s', (role) => {
    const want = MATRIX[role];
    expect(contractTabsFor(EXECUTION, accessOf(role)), 'execution tabs').toEqual(want.execution);
    expect(contractTabsFor(PROPOSAL, accessOf(role)), 'proposal tabs').toEqual(want.proposal);
    expect(opensContractPage(role, EXECUTION), 'execution contract page').toBe(want.contractPage);
    expect(opensContractPage(role, PROPOSAL), 'proposal contract page').toBe(want.contractPage && want.proposal.length > 0);
    expect(mayReadCostEntries(role), 'costs page').toBe(want.costsPage);
    expect(mayReadMeasurements(role), 'measurements page').toBe(want.measurementsPage);
  });
});
