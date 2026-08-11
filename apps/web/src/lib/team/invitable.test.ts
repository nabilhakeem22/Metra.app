import { describe, expect, it } from 'vitest';
import { INVITABLE_ROLES, isInvitableRole } from './invitable';

describe('isInvitableRole', () => {
  it('rejects owner and client', () => {
    expect(isInvitableRole('owner')).toBe(false);
    expect(isInvitableRole('client')).toBe(false);
  });

  it('accepts the internal roles', () => {
    for (const role of [
      'admin',
      'project_manager',
      'site_engineer',
      'accountant',
      'viewer',
    ]) {
      expect(isInvitableRole(role)).toBe(true);
    }
  });

  it('rejects unknown roles', () => {
    expect(isInvitableRole('superadmin')).toBe(false);
    expect(isInvitableRole('')).toBe(false);
  });

  it('INVITABLE_ROLES excludes owner and client', () => {
    expect(INVITABLE_ROLES).not.toContain('owner');
    expect(INVITABLE_ROLES).not.toContain('client');
    expect(INVITABLE_ROLES).toContain('admin');
    expect(INVITABLE_ROLES).toContain('viewer');
  });
});
