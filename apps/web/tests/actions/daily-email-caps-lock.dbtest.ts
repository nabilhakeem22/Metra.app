import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { emailDeliveryReminderCore } from '@/lib/engagements/reminder/email';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { createProposalCore } from '@/lib/proposals/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { auditRowCount, holdCapLock, seedAuditRows } from './daily-cap-fixture';
import { seedRoundBDelivery } from './round-b-fixture';

// Go-live security fix round 2, F1: the daily-cap lock fails CLOSED. Another
// session holds the (org, cap) lock for 6.5 s, longer than the app's 5 s
// lock_timeout, as a claimer stuck at the back of a long queue would. Before
// the fix that claim failed OPEN and the email went out past a full cap; now
// the action answers `busy` and writes and sends nothing. Once the lock is
// free the same action works as before. The session, the member lookup and
// Resend are replaced; the actions, the lock and the counts run on the
// seeded database.

const HOLD_SECONDS = 6.5;
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

const { inviteMember } = await import('@/lib/team/actions');
const { sendProposal } = await import('@/lib/proposals/actions');

const SECRET = 'daily-cap-lock-dbtest-secret-0123456789abcdef01234';
const ORIGIN = 'https://metra.example';
let previousSecret: string | undefined;
const orgIds: string[] = [];
beforeAll(() => {
  previousSecret = process.env.SHARE_LINK_SECRET;
  process.env.SHARE_LINK_SECRET = SECRET;
});
afterAll(async () => {
  if (previousSecret === undefined) delete process.env.SHARE_LINK_SECRET;
  else process.env.SHARE_LINK_SECRET = previousSecret;
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => {
  holder.sends = [];
});

/** A studio with `counted` invite emails today, its owner acting. */
async function studioWithInviteEmails(counted: number): Promise<string> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  holder.ctx = ctxFor(orgId, ownerIds[0], 'owner', 'owner@studio.test');
  await seedAuditRows(orgId, ownerIds[0], counted, { entity: 'invitation', action: 'create', after: {} });
  return orgId;
}

/** A studio's draft proposal for a client with an email address, its owner acting. */
async function draftProposal(): Promise<{ orgId: string; id: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  holder.ctx = ctx;
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme', email: 'client@buyer.test' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, { startDate: '2026-01-01', endDate: '2026-06-30', code: 'PRJ-1', nameEn: 'Tower', clientId: client.id, status: 'active' });
  const [project] = await listProjects(ctx, {});
  return { orgId, id: ((await createProposalCore(ctx, { clientId: client.id, projectId: project.id })) as { data?: string }).data! };
}

const invitationsTo = async (orgId: string, email: string) =>
  (await raw.query<{ n: number }>(`select count(*)::int as n from public.invitations where org_id = '${orgId}' and email = '${email}'`))[0].n;

describe('a claim that cannot take the cap lock (F1)', () => {
  it.each([
    ['at a full cap', 20],
    ['under the cap', 0],
  ])('%s, an invite behind a 6.5 s lock holder answers busy: no invitation, no email', async (_label, counted) => {
    const orgId = await studioWithInviteEmails(counted);
    const lock = holdCapLock(orgId, 'team_invite', HOLD_SECONDS);
    await lock.held;
    const email = `held-${randomUUID()}@example.com`;
    const started = Date.now();
    expect(await inviteMember({ email, role: 'viewer' })).toEqual({ ok: false, error: 'busy' });
    expect(Date.now() - started).toBeLessThan(HOLD_SECONDS * 1000);
    await lock.released;
    expect(await invitationsTo(orgId, email)).toBe(0);
    expect(holder.sends).toHaveLength(0);
  });

  it('a proposal send behind the holder answers busy: still a draft, no email', async () => {
    const { orgId, id } = await draftProposal();
    const lock = holdCapLock(orgId, 'client_email', HOLD_SECONDS);
    await lock.held;
    const answer = await sendProposal(id);
    await lock.released;
    expect(answer).toEqual({ ok: false, error: 'busy' });
    const [proposal] = await raw.query<{ status: string }>(`select status from public.proposals where id = '${id}'`);
    expect(proposal.status).toBe('draft');
    expect(holder.sends).toHaveLength(0);
  });

  it('a delivery reminder behind the holder answers busy: no audit row, no email', async () => {
    const delivery = await seedRoundBDelivery(orgIds, 'cap-lock');
    await raw.query(
      `update public.clients set email = 'client@example.com'
        where id = (select client_id from public.design_engagements where id = '${delivery.engagementId}')`,
    );
    const auditBefore = await auditRowCount(delivery.orgId, 'design_engagement');
    const lock = holdCapLock(delivery.orgId, 'client_email', HOLD_SECONDS);
    await lock.held;
    const answer = await emailDeliveryReminderCore(delivery.ctx, { engagementId: delivery.engagementId, locale: 'en' }, ORIGIN);
    await lock.released;
    expect(answer).toEqual({ ok: false, error: 'busy' });
    expect(await auditRowCount(delivery.orgId, 'design_engagement')).toBe(auditBefore);
    expect(holder.sends).toHaveLength(0);
  });

  it('once the holder commits, the same invite under the cap is created and emailed', async () => {
    const orgId = await studioWithInviteEmails(19);
    const lock = holdCapLock(orgId, 'team_invite', 1);
    await lock.held;
    const email = `after-${randomUUID()}@example.com`;
    const answer = await inviteMember({ email, role: 'viewer' });
    await lock.released;
    expect(answer).toEqual({ ok: true, link: expect.stringContaining('/invite/') });
    expect(await invitationsTo(orgId, email)).toBe(1);
    expect(holder.sends.map((sent) => sent.to)).toEqual([email]);
  });
});
