import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * §2.1 roles. Order is a contract shared with the TS `MemberRole` union in
 * @metra/web (lib/permissions/roles.ts). Do not reorder or rename.
 */
export const MEMBER_ROLES = [
  'owner',
  'admin',
  'project_manager',
  'site_engineer',
  'accountant',
  'client',
  'viewer',
] as const;

export const memberRole = pgEnum('member_role', MEMBER_ROLES);

/** §4.4 audit actions. */
export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'issue'] as const;

export const auditAction = pgEnum('audit_action', AUDIT_ACTIONS);

/** Team invitation lifecycle. */
export const INVITATION_STATUSES = [
  'pending',
  'accepted',
  'revoked',
  'expired',
] as const;

export const invitationStatus = pgEnum('invitation_status', INVITATION_STATUSES);

/**
 * P1 Price Book — the ORIGINAL cost-item category keys. The pgEnum is retired
 * (categories are now per-tenant `sections`); this plain const is kept as the
 * seed key list + import alias source. Do not reorder/rename.
 */
export const COST_ITEM_CATEGORIES = [
  'civil',
  'gypsum',
  'electrical',
  'plumbing',
  'joinery',
  'finishes',
  'furniture',
  'preliminaries',
] as const;

/** Cost-item units of measure. Labels localized (not stored). */
export const COST_ITEM_UNITS = [
  'sqm',
  'linear_meter',
  'pcs',
  'lump_sum',
  'day',
] as const;

export const costItemUnit = pgEnum('cost_item_unit', COST_ITEM_UNITS);

/** P1 Slice 2 — project lifecycle. Order is a contract; labels localized. */
export const PROJECT_STATUSES = [
  'draft',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const;

export const projectStatus = pgEnum('project_status', PROJECT_STATUSES);

/** P1 Slice 3 — proposal (عرض السعر) lifecycle. Order is a contract. */
export const PROPOSAL_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'superseded',
] as const;

export const proposalStatus = pgEnum('proposal_status', PROPOSAL_STATUSES);

/** P1 Slice 4 — client classification. Order is a contract; labels localized. */
export const CLIENT_TYPES = ['individual', 'company', 'consultant'] as const;

export const clientType = pgEnum('client_type', CLIENT_TYPES);

/**
 * P1 Slice 4 — contract (عقد) lifecycle. Order is a contract; labels localized.
 * OWNER-locked (A1): no `superseded` — re-generation/supersede is out of P1.
 * draft fully editable; once issued the row is immutable except status->signed
 * or ->terminated (enforced by enforce_immutable_when in apply-rls).
 */
export const CONTRACT_STATUSES = [
  'draft',
  'issued',
  'signed',
  'terminated',
] as const;

export const contractStatus = pgEnum('contract_status', CONTRACT_STATUSES);

/**
 * P1 Slice 4 — variation order (أمر تغيير) lifecycle. Order is a contract.
 * OWNER-locked (A2): a distinct INTERNAL-APPROVAL state before the client sees
 * it. draft (staff price the VO lines) -> internal_approved (owner/admin sign-off,
 * freezes netDelta) -> issued (client token minted) -> approved | rejected (client
 * via token). Frozen once it leaves draft (enforce_immutable_when in apply-rls).
 */
export const VARIATION_STATUSES = [
  'draft',
  'internal_approved',
  'issued',
  'approved',
  'rejected',
] as const;

export const variationStatus = pgEnum('variation_status', VARIATION_STATUSES);

/** Polymorphic activity-feed subject. `project` is provisioned now, wired later. */
export const ACTIVITY_ENTITY_TYPES = ['client', 'project'] as const;

export const activityEntityType = pgEnum(
  'activity_entity_type',
  ACTIVITY_ENTITY_TYPES,
);

/** Activity kinds: a manual note + the system events we emit. */
export const ACTIVITY_KINDS = [
  'note',
  'client_created',
  'proposal_sent',
  'proposal_accepted',
  'project_created',
] as const;

export const activityKind = pgEnum('activity_kind', ACTIVITY_KINDS);

/** P1 Slice 5 — per-project stage status. Order is a contract; labels localized. */
export const STAGE_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'done',
  'skipped',
] as const;

export const stageStatus = pgEnum('stage_status', STAGE_STATUSES);

/**
 * Design-engagement lifecycle (Design-Engagement Machine, Step 1). Order is a
 * contract; labels localized. Step 1 only ever creates rows in `created`; the
 * transition registry / guard engine / executor land in Step 2.
 */
export const DESIGN_ENGAGEMENT_STATES = [
  'created',
  'design_proposal',
  'survey',
  'layout',
  'concept_review',
  'negotiation',
  'design_3d',
  'final_approval',
  'shop_drawings',
  'boq',
  'execution_decision',
  'design_only_handoff',
  'closed_design_only',
  'execution',
  'abandoned',
] as const;

export const designEngagementState = pgEnum(
  'design_engagement_state',
  DESIGN_ENGAGEMENT_STATES,
);

/**
 * Design-Engagement Machine, Step 3 — the four fee-schedule milestone kinds.
 * `deposit` is always required; `gate_a`/`gate_b` are mid-project gates; `balance`
 * is the final payment. Order is a contract shared with the TS `MilestoneKind`
 * union in @metra/web; labels are localized (not stored).
 */
export const MILESTONE_KINDS = [
  'deposit',
  'gate_a',
  'gate_b',
  'balance',
] as const;

export const milestoneKind = pgEnum('milestone_kind', MILESTONE_KINDS);

/**
 * Design-Engagement Machine, Step 3 — how a milestone's `value` is interpreted.
 * `percent` (all milestones' percents must sum to exactly 100.0000) or `amount`
 * (all amounts must sum to the design fee to the piastre). A single schedule may
 * not mix the two bases. Order is a contract; labels are localized.
 */
export const MILESTONE_BASES = ['percent', 'amount'] as const;

export const milestoneBasis = pgEnum('milestone_basis', MILESTONE_BASES);

/**
 * Design-Engagement Machine, Step 4 — the kinds of payment recorded in the
 * append-only payment ledger. The four milestone kinds (`deposit`/`gate_a`/
 * `gate_b`/`balance`) plus `revision_co` for a paid revision change-order. This
 * is a DISTINCT enum from `milestone_kind` (which has no `revision_co`): a
 * milestone is a scheduled slice of the fee; a payment event is a cleared
 * receipt against the engagement. Order is a contract; labels are localized.
 */
export const PAYMENT_EVENT_KINDS = [
  'deposit',
  'gate_a',
  'gate_b',
  'balance',
  'revision_co',
] as const;

export const paymentEventKind = pgEnum('payment_event_kind', PAYMENT_EVENT_KINDS);

/**
 * Design-Engagement Machine, Step 5 — the kinds of engagement artifact recorded
 * against an engagement. The FULL set is declared now (so no later enum-add
 * migration is needed) even though Step 5 only writes `survey` / `autocad`:
 * `survey` (a measured site survey), `autocad` (a developer/consultant CAD set),
 * `concept_option` (a proposed layout/concept), `approved_render` (a signed-off
 * 3D render), `shop_drawing` (a production drawing) and `boq` (a bill of
 * quantities). Order is a contract shared with the TS `EngagementArtifactKind`
 * union in @metra/web; labels are localized (not stored).
 */
export const ENGAGEMENT_ARTIFACT_KINDS = [
  'survey',
  'autocad',
  'concept_option',
  'approved_render',
  'shop_drawing',
  'boq',
] as const;

export const engagementArtifactKind = pgEnum(
  'engagement_artifact_kind',
  ENGAGEMENT_ARTIFACT_KINDS,
);

/**
 * Design-Engagement Machine, Step 7 — the kinds of decision recorded in the
 * append-only engagement approvals ledger (`engagement_events`). The FULL set is
 * declared now (so no later enum-add migration is needed) even though Step 7 only
 * writes `concept_approval`: `concept_approval` (the client/internal selection of
 * a concept that opens negotiation), `design_approval` (final 3D sign-off),
 * `rom_acknowledgement` (the client's acknowledgement of a rough order-of-magnitude
 * range — uses the reserved range_low/range_high columns) and
 * `handoff_acknowledgement` (design-only handoff receipt). Order is a contract
 * shared with the TS `EngagementEventKind` union in @metra/web; labels localized.
 */
export const ENGAGEMENT_EVENT_KINDS = [
  'concept_approval',
  'design_approval',
  'rom_acknowledgement',
  'handoff_acknowledgement',
] as const;

export const engagementEventKind = pgEnum(
  'engagement_event_kind',
  ENGAGEMENT_EVENT_KINDS,
);

/**
 * Design-Engagement Machine, Step 8 — the lifecycle of a design-fee change order
 * raised when a revision crosses the free-revision allowance. `raised` on INSERT;
 * `settled` once the matching revision_co payment is recorded (the raised->settled
 * path is Step 9, not this step). Order is a contract; labels localized.
 */
export const CHANGE_ORDER_STATUSES = ['raised', 'settled'] as const;

export const changeOrderStatus = pgEnum(
  'change_order_status',
  CHANGE_ORDER_STATUSES,
);

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
export type CostItemCategory = (typeof COST_ITEM_CATEGORIES)[number];
export type CostItemUnit = (typeof COST_ITEM_UNITS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ClientType = (typeof CLIENT_TYPES)[number];
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type VariationStatus = (typeof VARIATION_STATUSES)[number];
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type StageStatus = (typeof STAGE_STATUSES)[number];
export type DesignEngagementState = (typeof DESIGN_ENGAGEMENT_STATES)[number];
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];
export type MilestoneBasis = (typeof MILESTONE_BASES)[number];
export type PaymentEventKind = (typeof PAYMENT_EVENT_KINDS)[number];
export type EngagementArtifactKind = (typeof ENGAGEMENT_ARTIFACT_KINDS)[number];
export type EngagementEventKind = (typeof ENGAGEMENT_EVENT_KINDS)[number];
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];
