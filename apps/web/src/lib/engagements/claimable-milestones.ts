// The design-fee milestones a client can mark as paid on the delivery page,
// with a one-time code (app_home_claim_design_payment_by_token). PURE and
// CLIENT-SAFE: the client acts' studio notice (./client-acts/acts.ts) and the
// home link that opens a claim (lib/client-home/tab.ts) read the same list.
import type { MilestoneKind } from '@metra/db';

export const CLAIMABLE_MILESTONE_KINDS = ['deposit', 'gate_a', 'gate_b', 'balance'] as const satisfies readonly MilestoneKind[];

export type ClaimableMilestoneKind = (typeof CLAIMABLE_MILESTONE_KINDS)[number];

/** The claimable milestone `value` names, or null. */
export function claimableMilestoneOf(value: unknown): ClaimableMilestoneKind | null {
  return CLAIMABLE_MILESTONE_KINDS.find((kind) => kind === value) ?? null;
}
