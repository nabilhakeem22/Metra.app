import { describe, expect, it } from 'vitest';
import { can } from './can';
import { PERMISSION_MATRIX } from './matrix';
import { MEMBER_ROLES } from './roles';

describe('§2.2 permission matrix', () => {
  it('covers all 7 roles for every capability', () => {
    for (const cap of Object.keys(PERMISSION_MATRIX)) {
      const roles = Object.keys(
        PERMISSION_MATRIX[cap as keyof typeof PERMISSION_MATRIX],
      );
      expect(roles.sort()).toEqual([...MEMBER_ROLES].sort());
    }
  });

  // Sampled cells, verified against §2.2.
  it.each([
    ['owner', 'users_settings', 'approve', true],
    ['admin', 'users_settings', 'approve', false], // admin is CRU, no A
    ['project_manager', 'users_settings', 'read', false],
    ['owner', 'price_book', 'create', true],
    ['project_manager', 'price_book', 'create', false],
    ['project_manager', 'price_book', 'read', true],
    ['site_engineer', 'cost_entries', 'create', true],
    ['site_engineer', 'cost_entries', 'approve', false],
    ['accountant', 'cost_entries', 'approve', true],
    ['client', 'proposals_send', 'approve', true],
    ['client', 'proposals_build', 'read', false],
    ['viewer', 'margin_pnl', 'read', false],
    ['owner', 'margin_pnl', 'read', true],
    ['site_engineer', 'tasks_schedule', 'update', true],
    ['site_engineer', 'tasks_schedule', 'create', false],
    ['accountant', 'custody_settle', 'approve', true],
    ['project_manager', 'custody_settle', 'approve', false],
    ['client', 'clients', 'read', false],
    ['viewer', 'contracts_generate', 'read', true],
    ['accountant', 'contracts_issue', 'approve', false],
  ] as const)('can(%s, %s, %s) === %s', (role, cap, action, expected) => {
    expect(can(role as never, cap as never, action as never)).toBe(expected);
  });

  it('unknown/none cells deny', () => {
    expect(can('client', 'price_book', 'read')).toBe(false);
    expect(can('site_engineer', 'price_book', 'read')).toBe(false);
  });
});
