import { randomUUID } from 'node:crypto';
import { createDb } from '@metra/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { seedAuditRows } from './daily-cap-fixture';
import { startLatencyProxy, type LatencyProxy } from './latency-proxy';

// Go-live security fix round 2, F1, as the functional tester measured it: a
// burst of invites at a studio whose invite cap is FULL, with a 50 ms database
// round trip and, as on Cloudflare, one connection per request. The lock queue
// is then as long as the burst, so the claims at its back wait past the 5 s
// lock_timeout. They used to fail OPEN (8 of 20, 17 of 30 emails past a full
// cap); now they answer `busy`. Each action opens its own connection through
// a TCP proxy that delays every chunk 25 ms each way. The session, the member
// lookup and Resend are replaced.

const ONE_WAY_MS = 25;
const holder = vi.hoisted(() => ({
  ctx: null as OrgContext | null,
  sends: [] as Array<{ to: unknown }>,
  proxyUrl: '',
}));
vi.mock('@/lib/db/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/client')>();
  return {
    ...real,
    withRequestDb: async <T>(fn: (db: import('@metra/db').MetraDb) => Promise<T>): Promise<T> => {
      const connection = createDb(holder.proxyUrl, { prepare: false, max: 1 });
      try {
        return await fn(connection.db);
      } finally {
        await connection.sql.end({ timeout: 5 });
      }
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

let proxy: LatencyProxy;
const orgIds: string[] = [];
beforeAll(async () => {
  proxy = await startLatencyProxy(process.env.DATABASE_URL as string, ONE_WAY_MS);
  holder.proxyUrl = proxy.url;
});
afterAll(async () => {
  await proxy.close();
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => {
  holder.sends = [];
});

async function studioWithInviteEmails(counted: number): Promise<string> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  holder.ctx = ctxFor(orgId, ownerIds[0], 'owner', 'owner@studio.test');
  await seedAuditRows(orgId, ownerIds[0], counted, { entity: 'invitation', action: 'create', after: {} });
  return orgId;
}

const pendingInvites = async (orgId: string) =>
  (await raw.query<{ n: number }>(`select count(*)::int as n from public.invitations where org_id = '${orgId}' and status = 'pending'`))[0].n;

/** `size` concurrent invites, each on its own connection through the proxy. */
async function burst(size: number) {
  const emails = Array.from({ length: size }, () => `burst-${randomUUID()}@example.com`);
  return Promise.all(emails.map((email) => inviteMember({ email, role: 'viewer' })));
}

describe('a burst at 50 ms round trip, one connection per request (F1)', () => {
  it.each([20, 30])('%i concurrent invites at a FULL cap send 0 emails; every answer is a link or busy', async (size) => {
    const orgId = await studioWithInviteEmails(20);
    const answers = await burst(size);
    expect(holder.sends).toHaveLength(0);
    const busy = answers.filter((answer) => !answer.ok);
    expect(busy.every((answer) => answer.error === 'busy')).toBe(true);
    expect(busy.length).toBeGreaterThan(0);
    expect(await pendingInvites(orgId)).toBe(size - busy.length);
  });

  it('20 concurrent invites with 5 left under the cap send at most 5 emails', async () => {
    const orgId = await studioWithInviteEmails(15);
    const answers = await burst(20);
    expect(holder.sends.length).toBeLessThanOrEqual(5);
    expect(answers.filter((answer) => !answer.ok).every((answer) => answer.error === 'busy')).toBe(true);
    expect(await pendingInvites(orgId)).toBe(answers.filter((answer) => answer.ok).length);
  });

  it('a single invite under the cap still goes out through the same slow connection', async () => {
    const orgId = await studioWithInviteEmails(0);
    const [answer] = await burst(1);
    expect(answer).toEqual({ ok: true, link: expect.stringContaining('/invite/') });
    expect(holder.sends).toHaveLength(1);
    expect(await pendingInvites(orgId)).toBe(1);
  });
});
