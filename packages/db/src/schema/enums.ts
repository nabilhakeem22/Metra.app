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

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
