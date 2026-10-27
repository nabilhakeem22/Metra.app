import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, seedPendingInvite, teardown } from './fixture';
import { seedAuditRows } from './daily-cap-fixture';

// S4 (go-live security), team invites: past 20 invite emails in a rolling day
// the invite (or resend) still happens and its link comes back, and no email
// goes out. The counts are the real queries under the org's RLS context. The
// session, the member identity lookup (Supabase admin) and Resend are replaced.

const holder = vi.hoisted(() => ({ ctx: null as OrgContext | null, sends: [] as Array<{ to: unknown }> }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: async () => holder.ctx }));
vi.mock('@/lib/team/identities', () => ({ getOrgMemberIdentities: async () => [] }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: unknown }) => {
        holder.sends.push(payload);
        return { error: null };
      },
    };
  },
}));
process.env.RESEND_API_KEY = 'test-key';
process.env.RESEND_FROM = 'team@metra.test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.metra.test';

const { inviteMember, resendInvite } = await import('@/lib/team/actions');

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => {
  holder.sends = [];
});

async function ownerOfNewOrg(): Promise<{ orgId: string; ownerId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  holder.ctx = ctxFor(orgId, ownerIds[0], 'owner', 'owner@studio.test');
  return { orgId, ownerId: ownerIds[0] };
}

async function invite(email: string) {
  return inviteMember({ email, role: 'viewer' });
}

const pendingInvites = async (orgId: string, email: string) =>
  (await raw.query<{ n: number }>(`select count(*)::int as n from public.invitations where org_id = '${orgId}' and email = '${email}' and status = 'pending'`))[0].n;

describe('the daily team invite email cap', () => {
  it('at 20 invite emails today the invite is created and its link returned, with no email; another studio still emails', async () => {
    const capped = await ownerOfNewOrg();
    await seedAuditRows(capped.orgId, capped.ownerId, 15, { entity: 'invitation', action: 'create', after: { email: 'x', role: 'viewer' } });
    await seedAuditRows(capped.orgId, capped.ownerId, 5, { entity: 'invitation', action: 'update', after: { resent: true } });
    const email = `capped-${randomUUID()}@example.com`;
    const answer = await invite(email);
    expect(answer).toEqual({ ok: true, link: expect.stringMatching(/^https:\/\/app\.metra\.test\/.+\/invite\//) });
    expect(await pendingInvites(capped.orgId, email)).toBe(1);
    expect(holder.sends).toHaveLength(0);

    await ownerOfNewOrg();
    const elsewhere = `free-${randomUUID()}@example.com`;
    expect((await invite(elsewhere)).ok).toBe(true);
    expect(holder.sends.map((sent) => sent.to)).toEqual([elsewhere]);
  });

  it('counts neither rows older than a day nor a revoke', async () => {
    const studio = await ownerOfNewOrg();
    await seedAuditRows(studio.orgId, studio.ownerId, 20, { entity: 'invitation', action: 'create', after: {}, hoursAgo: 25 });
    await seedAuditRows(studio.orgId, studio.ownerId, 20, { entity: 'invitation', action: 'update', after: { status: 'revoked' } });
    await seedAuditRows(studio.orgId, studio.ownerId, 19, { entity: 'invitation', action: 'create', after: {} });
    const email = `under-${randomUUID()}@example.com`;
    expect((await invite(email)).ok).toBe(true);
    expect(holder.sends.map((sent) => sent.to)).toEqual([email]);
  });

  it('a resend past the cap rotates the link and returns it, with no email', async () => {
    const studio = await ownerOfNewOrg();
    const email = `resend-${randomUUID()}@example.com`;
    const invitationId = await seedPendingInvite(studio.orgId, email, studio.ownerId);
    await seedAuditRows(studio.orgId, studio.ownerId, 20, { entity: 'invitation', action: 'update', after: { resent: true } });
    const [before] = await raw.query<{ token_hash: string }>(`select token_hash from public.invitations where id = '${invitationId}'`);
    const answer = await resendInvite(invitationId);
    expect(answer).toEqual({ ok: true, link: expect.stringContaining('/invite/') });
    const [after] = await raw.query<{ token_hash: string }>(`select token_hash from public.invitations where id = '${invitationId}'`);
    expect(after.token_hash).not.toBe(before.token_hash);
    expect(holder.sends).toHaveLength(0);
  });
});
