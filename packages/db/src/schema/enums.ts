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
] as const;

export const activityKind = pgEnum('activity_kind', ACTIVITY_KINDS);

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
export type CostItemCategory = (typeof COST_ITEM_CATEGORIES)[number];
export type CostItemUnit = (typeof COST_ITEM_UNITS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ClientType = (typeof CLIENT_TYPES)[number];
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
