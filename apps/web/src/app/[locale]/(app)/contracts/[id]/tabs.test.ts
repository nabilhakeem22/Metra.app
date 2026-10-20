import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@metra/db';
import { maySeeBilling } from '@/lib/execution/billing/access';
import { contractTabsFor, openingContractTab } from './tabs';

// PR A4.3: who sees which tab of a contract. The Payments tab is an execution
// contract's, for the roles with `payments` read; the rest of the contract is
// for the roles with `contracts_generate` read. A project manager or an
// accountant bills without opening the contract itself.

const accessOf = (role: MemberRole) => ({ seeContract: can(role, 'contracts_generate', 'read'), seeBilling: maySeeBilling(role) });
const EXECUTION = { sourceBoqId: 'b-1' };
const PROPOSAL = { sourceBoqId: null };

describe('contractTabsFor', () => {
  it('gives the owner, the admin and the viewer every tab of an execution contract', () => {
    for (const role of ['owner', 'admin', 'viewer'] as const) {
      expect(contractTabsFor(EXECUTION, accessOf(role)), role).toEqual(['overview', 'schedule', 'payments', 'variations']);
    }
  });

  it('gives the project manager and the accountant the Payments tab alone, and nothing of a proposal contract', () => {
    for (const role of ['project_manager', 'accountant'] as const) {
      expect(contractTabsFor(EXECUTION, accessOf(role)), role).toEqual(['payments']);
      expect(contractTabsFor(PROPOSAL, accessOf(role)), role).toEqual([]);
    }
    expect(contractTabsFor(EXECUTION, accessOf('site_engineer'))).toEqual([]);
  });

  it('a proposal contract has no schedule and no payments', () => {
    expect(contractTabsFor(PROPOSAL, accessOf('owner'))).toEqual(['overview', 'variations']);
  });

  it('opens on the asked tab when this person has it, else on their first', () => {
    expect(openingContractTab('payments', ['overview', 'payments'])).toBe('payments');
    expect(openingContractTab('schedule', ['payments'])).toBe('payments');
    expect(openingContractTab(['payments'], ['overview', 'payments'])).toBe('overview');
  });
});
