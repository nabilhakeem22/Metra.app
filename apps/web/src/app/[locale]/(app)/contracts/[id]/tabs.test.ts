import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/can';
import { MEMBER_ROLES, type MemberRole } from '@/lib/permissions/roles';
import { maySeeBilling } from '@/lib/execution/billing/access';
import { mayReadCostEntries } from '@/lib/execution/costs/access';
import { contractTabsFor, openingContractTab, type ContractTab } from './tabs';

// PR A4.3 and B3: who sees which tab of a contract. The Payments tab is an
// execution contract's, for the roles with `payments` read; the Costs tab is an
// execution contract's, for the roles that read both the contract and its costs;
// the rest of the contract is for the roles with `contracts_generate` read. A
// project manager or an accountant bills without opening the contract itself,
// and records costs on the costs page (./costs/page.tsx).

const accessOf = (role: MemberRole) => ({
  seeContract: can(role, 'contracts_generate', 'read'),
  seeBilling: maySeeBilling(role),
  readsCosts: mayReadCostEntries(role),
});
const EXECUTION = { sourceBoqId: 'b-1' };
const PROPOSAL = { sourceBoqId: null };

describe('contractTabsFor', () => {
  it('gives the owner and the admin every tab of an execution contract, the viewer all but the costs', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(contractTabsFor(EXECUTION, accessOf(role)), role).toEqual(['overview', 'schedule', 'payments', 'costs', 'variations']);
    }
    expect(contractTabsFor(EXECUTION, accessOf('viewer'))).toEqual(['overview', 'schedule', 'payments', 'variations']);
  });

  it('gives the project manager and the accountant the Payments tab alone, and nothing of a proposal contract', () => {
    for (const role of ['project_manager', 'accountant'] as const) {
      expect(contractTabsFor(EXECUTION, accessOf(role)), role).toEqual(['payments']);
      expect(contractTabsFor(PROPOSAL, accessOf(role)), role).toEqual([]);
    }
    expect(contractTabsFor(EXECUTION, accessOf('site_engineer'))).toEqual([]);
  });

  it('a proposal contract has no schedule, no payments and no costs', () => {
    expect(contractTabsFor(PROPOSAL, accessOf('owner'))).toEqual(['overview', 'variations']);
  });

  it('opens on the asked tab when this person has it, else on their first', () => {
    expect(openingContractTab('payments', ['overview', 'payments'])).toBe('payments');
    expect(openingContractTab('costs', ['overview', 'payments', 'costs'])).toBe('costs');
    expect(openingContractTab('schedule', ['payments'])).toBe('payments');
    expect(openingContractTab(['payments'], ['overview', 'payments'])).toBe('overview');
  });
});

// Every role of the matrix against every tab and page, so a new role or a moved
// grant fails here until someone says what it sees. The contract page answers
// 404 unless the role reads the contract or its payments AND has a tab on this
// contract (the two notFound() calls in page.tsx); the costs page is gated on
// reading costs alone (./costs/page.tsx).
describe('every role against every contract tab and page', () => {
  const MATRIX: Record<MemberRole, { execution: ContractTab[]; proposal: ContractTab[]; costsPage: boolean }> = {
    owner: { execution: ['overview', 'schedule', 'payments', 'costs', 'variations'], proposal: ['overview', 'variations'], costsPage: true },
    admin: { execution: ['overview', 'schedule', 'payments', 'costs', 'variations'], proposal: ['overview', 'variations'], costsPage: true },
    project_manager: { execution: ['payments'], proposal: [], costsPage: true },
    site_engineer: { execution: [], proposal: [], costsPage: true },
    accountant: { execution: ['payments'], proposal: [], costsPage: true },
    client: { execution: [], proposal: [], costsPage: false },
    viewer: { execution: ['overview', 'schedule', 'payments', 'variations'], proposal: ['overview', 'variations'], costsPage: false },
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
    expect(opensContractPage(role, EXECUTION), 'execution contract page').toBe(want.execution.length > 0);
    expect(opensContractPage(role, PROPOSAL), 'proposal contract page').toBe(want.proposal.length > 0);
    expect(mayReadCostEntries(role), 'costs page').toBe(want.costsPage);
  });
});
