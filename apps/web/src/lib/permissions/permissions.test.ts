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

describe('price_book capability (P1 Slice 1)', () => {
  const actions = ['create', 'read', 'update', 'approve'] as const;

  it('owner and admin have full CRUA', () => {
    for (const role of ['owner', 'admin'] as const) {
      for (const a of actions) {
        expect(can(role, 'price_book', a)).toBe(true);
      }
    }
  });

  it('project_manager and accountant are read-only', () => {
    for (const role of ['project_manager', 'accountant'] as const) {
      expect(can(role, 'price_book', 'read')).toBe(true);
      expect(can(role, 'price_book', 'create')).toBe(false);
      expect(can(role, 'price_book', 'update')).toBe(false);
      expect(can(role, 'price_book', 'approve')).toBe(false);
    }
  });

  it('site_engineer, client and viewer have no access', () => {
    for (const role of ['site_engineer', 'client', 'viewer'] as const) {
      for (const a of actions) {
        expect(can(role, 'price_book', a)).toBe(false);
      }
    }
  });
});

describe('clients + projects capabilities (P1 Slice 2)', () => {
  it('owner and admin have full CRUA on both', () => {
    for (const role of ['owner', 'admin'] as const) {
      for (const cap of ['clients', 'projects'] as const) {
        for (const a of ['create', 'read', 'update', 'approve'] as const) {
          expect(can(role, cap, a)).toBe(true);
        }
      }
    }
  });

  it('project_manager has CRU (no approve) on both', () => {
    for (const cap of ['clients', 'projects'] as const) {
      expect(can('project_manager', cap, 'create')).toBe(true);
      expect(can('project_manager', cap, 'read')).toBe(true);
      expect(can('project_manager', cap, 'update')).toBe(true);
      expect(can('project_manager', cap, 'approve')).toBe(false);
    }
  });

  it('site_engineer, accountant and viewer are read-only on both', () => {
    for (const role of ['site_engineer', 'accountant', 'viewer'] as const) {
      for (const cap of ['clients', 'projects'] as const) {
        expect(can(role, cap, 'read')).toBe(true);
        expect(can(role, cap, 'create')).toBe(false);
        expect(can(role, cap, 'update')).toBe(false);
      }
    }
  });

  it('client role: no clients access (404), but can read projects', () => {
    expect(can('client', 'clients', 'read')).toBe(false);
    expect(can('client', 'projects', 'read')).toBe(true);
    expect(can('client', 'projects', 'create')).toBe(false);
  });
});
