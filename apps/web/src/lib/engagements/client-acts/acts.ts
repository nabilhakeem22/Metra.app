// What the client just did on the delivery portal, and who in the studio hears
// about it. PURE and CLIENT-SAFE: no db, no server-only.
//
// THE SERVER-SIDE MAP the notifier's caller contract asks for
// (app_delivery_notify_studio_by_token, 50-delivery-write.sql). The body key,
// the role list and the params are all derived HERE from the act the portal
// write just performed, never from request input: a client can choose what to
// approve, not who in the studio gets emailed or what their feed says.
import type { MilestoneKind } from '@metra/db';
import { can } from '@/lib/permissions/can';
import { MEMBER_ROLES, type MemberRole } from '@/lib/permissions/member-roles';

export type ClientActKind =
  | 'concept_approved'
  | 'concept_chosen'
  | 'concept_changes_requested'
  | 'design_approved'
  | 'design_changes_requested'
  | 'budget_acknowledged'
  | 'handover_acknowledged'
  | 'payment_claimed'
  | 'commented';

export interface ClientAct {
  kind: ClientActKind;
  /** Only on `payment_claimed`: the milestone the client marked as paid. */
  milestoneKind?: MilestoneKind;
}

/** The notification body key of each act: the nine keys the notifier allows. */
export const CLIENT_ACT_BODY_KEY = {
  concept_approved: 'client_concept_approved',
  concept_chosen: 'client_concept_chosen',
  concept_changes_requested: 'client_concept_changes_requested',
  design_approved: 'client_design_approved',
  design_changes_requested: 'client_design_changes_requested',
  budget_acknowledged: 'client_budget_acknowledged',
  handover_acknowledged: 'client_handover_acknowledged',
  payment_claimed: 'client_payment_claimed',
  commented: 'client_commented',
} as const satisfies Record<ClientActKind, `client_${ClientActKind}`>;

/** The portal's respond verbs (app_delivery_respond_by_token) and the act each records. */
const ACT_OF_VERB: Readonly<Record<string, ClientActKind>> = {
  approve_concept: 'concept_approved',
  request_concept_changes: 'concept_changes_requested',
  approve_design: 'design_approved',
  request_design_changes: 'design_changes_requested',
  acknowledge_rom: 'budget_acknowledged',
  acknowledge_handoff: 'handover_acknowledged',
};

/** The milestones a client can mark as paid (app_delivery_claim_payment_by_token). */
const CLAIMABLE_MILESTONES = ['deposit', 'gate_a', 'gate_b', 'balance'] as const satisfies
  readonly MilestoneKind[];

/** The act one of the six respond verbs records, or null for anything else. */
export function clientActOfVerb(verb: string): ClientAct | null {
  const kind = Object.hasOwn(ACT_OF_VERB, verb) ? ACT_OF_VERB[verb] : undefined;
  return kind ? { kind } : null;
}

/** The payment claim act for a milestone, or null when it is not a claimable one. */
export function paymentClaimedAct(milestoneKind: string): ClientAct | null {
  const milestone = CLAIMABLE_MILESTONES.find((kind) => kind === milestoneKind);
  return milestone ? { kind: 'payment_claimed', milestoneKind: milestone } : null;
}

/**
 * Who hears about the act: every member role that can ACT on it, read from the
 * permission matrix at call time so the list never drifts from it (owner
 * decision Q2). A payment claim is the finance roles' to confirm
 * (`engagements_finance` create); every other act is the design roles' to
 * answer (`engagements_design` update). The client role never hears.
 */
export function recipientRolesFor(act: ClientAct): MemberRole[] {
  const [capability, action] =
    act.kind === 'payment_claimed'
      ? (['engagements_finance', 'create'] as const)
      : (['engagements_design', 'update'] as const);
  return MEMBER_ROLES.filter((role) => role !== 'client' && can(role, capability, action));
}

/** The params the notification carries beyond the delivery's own identity. */
export function clientActParams(act: ClientAct): Record<string, string> {
  return act.milestoneKind ? { milestoneKind: act.milestoneKind } : {};
}

/**
 * The act a notification body key reports: the inverse of CLIENT_ACT_BODY_KEY
 * (the hourly sweep reads keys back from SQL). A payment claim needs its
 * claimable milestone; every other act takes none. Anything else is null.
 */
export function clientActOfBodyKey(bodyKey: string, milestoneKind: string | null): ClientAct | null {
  const kind = (Object.keys(CLIENT_ACT_BODY_KEY) as ClientActKind[]).find(
    (candidate) => CLIENT_ACT_BODY_KEY[candidate] === bodyKey,
  );
  if (!kind) return null;
  if (kind === 'payment_claimed') return milestoneKind === null ? null : paymentClaimedAct(milestoneKind);
  return milestoneKind === null ? { kind } : null;
}

/**
 * Who hears each act, keyed by its body key: the role map the hourly sweep
 * hands app_notify_lost_client_acts, from the same matrix rule as a first tap.
 */
export function recipientRolesByBodyKey(): Record<string, MemberRole[]> {
  return Object.fromEntries(
    (Object.keys(CLIENT_ACT_BODY_KEY) as ClientActKind[]).map((kind) => [
      CLIENT_ACT_BODY_KEY[kind],
      recipientRolesFor({ kind }),
    ]),
  );
}
