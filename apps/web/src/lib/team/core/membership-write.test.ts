import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

// The membership role-writer trigger's refusal (SQLSTATE MT150) reaching the two
// team cores that write a role (security batch 3, A5): `forbidden`, one redacted
// warning and no defect line. The transaction is an in-memory handle whose
// membership write is refused the way drizzle rethrows a postgres.js error.

vi.mock('server-only', () => ({}));
const database = vi.hoisted(() => ({ writeFailure: null as unknown, written: 0 }));
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async (_ctx: unknown, run: (tx: unknown) => Promise<unknown>) => {
    const write = async () => {
      if (database.writeFailure) throw database.writeFailure;
      database.written += 1;
    };
    return run({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'membership-1', role: 'project_manager' }] }) }) }),
      update: () => ({ set: () => ({ where: write }) }),
      delete: () => ({ where: write }),
    });
  },
}));
vi.mock('@/lib/aggregates/membership', () => ({ lockOrgMemberships: async () => undefined, ensureNotLastOwner: async () => undefined }));
vi.mock('@/lib/site/close-site-access', () => ({ closeSiteAccessOf: async () => undefined }));
vi.mock('@/lib/api-keys/revoke-creator-keys', () => ({ revokeKeysCreatedBy: async () => undefined }));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => audit);

const { changeMemberRoleCore, removeMemberCore } = await import('./index');
const { writeMembership } = await import('./membership-write');

// The request was opened while the caller was an owner; the database knows better.
const ctx = { orgId: 'org-1', userId: 'caller-1', role: 'owner' } as unknown as OrgContext;
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** A refused statement as drizzle rethrows it: the wrapper carries the query and its values. */
function refusedWith(code: string): Error {
  return Object.assign(new Error('Failed query: update "memberships" set "role" = $1\nparams: viewer,member-7'), {
    query: 'update "memberships" set "role" = $1',
    params: ['viewer', 'member-7'],
    cause: { code, message: 'membership_write_refused', severity: 'ERROR', detail: 'only an owner or admin may grant, change or remove a role' },
  });
}

const CORES = [
  ['changeMemberRoleCore', () => changeMemberRoleCore(ctx, { userId: 'member-7', role: 'viewer' })],
  ['removeMemberCore', () => removeMemberCore(ctx, 'member-7')],
] as const;

let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  database.writeFailure = null;
  database.written = 0;
  audit.recordAudit.mockClear();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(CORES)('%s when the database refuses the membership write', (_name, run) => {
  it('answers forbidden for MT150, audits nothing, and leaves one redacted warning instead of a defect line', async () => {
    database.writeFailure = refusedWith('MT150');
    expect(await run()).toEqual({ ok: false, error: 'forbidden' });
    expect(audit.recordAudit).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings.mock.calls).toEqual([
      ['membership write refused by the database', { failure: { code: 'MT150', message: 'membership_write_refused' } }],
    ]);
    expect(JSON.stringify(warnings.mock.calls)).not.toContain('member-7');
  });

  it('leaves any other refusal in the referenced tail, logged as a defect', async () => {
    database.writeFailure = refusedWith('42501');
    expect(await run()).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
    expect(errors.mock.calls.map(([label]) => label)).toEqual(['mutateInOrg failed']);
    expect(warnings).not.toHaveBeenCalled();
  });

  it('writes and audits once when the database allows it', async () => {
    expect(await run()).toMatchObject({ ok: true });
    expect(database.written).toBe(1);
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    expect(warnings).not.toHaveBeenCalled();
  });
});

describe('writeMembership', () => {
  it('rethrows a failure that is not MT150 as the same object', async () => {
    const failure = refusedWith('23505');
    await expect(writeMembership(async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(warnings).not.toHaveBeenCalled();
  });
});
