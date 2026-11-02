import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { DAILY_EMAIL_CAPS } from '@/lib/email/daily-caps';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { createProposalCore } from '@/lib/proposals/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Go-live security fix round, T2: the daily email caps are a LOCK, not a
// brake. Before the fix, 150 invites fired at once sent 150 emails (each read
// the count before any of the others committed its row). Now each claim takes
// the (org, cap) transaction lock in the transaction that writes the counted
// row, so a burst of any size is allowed exactly the cap. The session, the
// member lookup (Supabase admin) and Resend are replaced; the actions, the
// counts and the lock run on the seeded database.
//
// The cap's verdict is asserted on the claims themselves (each real
// claimDailyEmail answer is recorded). Delivery is asserted as "never more
// than the cap": under a loaded CI runner an allowed email can still miss its
// own 5 s send deadline, which is the mailer's outcome, not the cap's.

const BURST = 150;
const holder = vi.hoisted(() => ({ ctx: null as OrgContext | null, sends: [] as Array<{ to: unknown }>, claims: [] as boolean[] }));
vi.mock('@/lib/email/daily-caps', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email/daily-caps')>();
  return {
    ...real,
    claimDailyEmail: async (...args: Parameters<typeof real.claimDailyEmail>) => {
      const allowed = await real.claimDailyEmail(...args);
      holder.claims.push(allowed);
      return allowed;
    },
  };
});
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

const SECRET = 'daily-cap-burst-dbtest-secret-0123456789abcdef012345';
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
  holder.claims = [];
});

async function ownerOfNewOrg(): Promise<{ orgId: string; ctx: OrgContext }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  holder.ctx = ctxFor(orgId, ownerIds[0], 'owner', 'owner@studio.test');
  return { orgId, ctx: holder.ctx };
}

/** `count` draft proposals for one client who has an email address. */
async function draftProposals(ctx: OrgContext, count: number): Promise<string[]> {
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme', email: 'client@buyer.test' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, { startDate: '2026-01-01', endDate: '2026-06-30', code: 'PRJ-1', nameEn: 'Tower', clientId: client.id, status: 'active' });
  const [project] = await listProjects(ctx, {});
  const ids: string[] = [];
  for (let n = 0; n < count; n += 1) {
    ids.push(((await createProposalCore(ctx, { clientId: client.id, projectId: project.id })) as { data?: string }).data!);
  }
  return ids;
}

const countOf = async (query: string) => (await raw.query<{ n: number }>(query))[0].n;

/** Every action claimed once, exactly `cap` claims were allowed, and the mailer was never asked for more. */
function expectExactlyTheCap(cap: number) {
  expect(holder.claims).toHaveLength(BURST);
  expect(holder.claims.filter(Boolean)).toHaveLength(cap);
  expect(holder.sends.length).toBeLessThanOrEqual(cap);
}

describe('the daily email caps under a burst (T2)', () => {
  it(`${BURST} concurrent invites create ${BURST} invitations and allow exactly ${DAILY_EMAIL_CAPS.team_invite} emails`, async () => {
    const { orgId } = await ownerOfNewOrg();
    const emails = Array.from({ length: BURST }, () => `burst-${randomUUID()}@example.com`);
    const answers = await Promise.all(emails.map((email) => inviteMember({ email, role: 'viewer' })));
    expect(answers.every((answer) => answer.ok)).toBe(true);
    expectExactlyTheCap(DAILY_EMAIL_CAPS.team_invite);
    expect(await countOf(`select count(*)::int as n from public.invitations where org_id = '${orgId}' and status = 'pending'`)).toBe(BURST);
  });

  it(`${BURST} concurrent proposal sends send every proposal and allow exactly ${DAILY_EMAIL_CAPS.client_email} client emails`, async () => {
    const { orgId, ctx } = await ownerOfNewOrg();
    const ids = await draftProposals(ctx, BURST);
    const answers = await Promise.all(ids.map((id) => sendProposal(id)));
    expect(answers.every((answer) => answer.ok && answer.link)).toBe(true);
    expectExactlyTheCap(DAILY_EMAIL_CAPS.client_email);
    expect(answers.filter((answer) => answer.emailSent).length).toBeLessThanOrEqual(DAILY_EMAIL_CAPS.client_email);
    expect(await countOf(`select count(*)::int as n from public.proposals where org_id = '${orgId}' and status = 'sent'`)).toBe(BURST);
  });
});
