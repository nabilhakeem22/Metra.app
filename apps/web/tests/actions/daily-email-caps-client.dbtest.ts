import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { emailDeliveryReminderCore } from '@/lib/engagements/reminder/email';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { createProposalCore, saveProposalDraftCore } from '@/lib/proposals/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { auditRowCount, seedAuditRows, seedSentProposalEvents } from './daily-cap-fixture';
import { seedRoundBDelivery } from './round-b-fixture';

// S4 (go-live security), client emails: past 60 in a rolling day (proposal
// sends plus delivery reminder emails, in any mix) a proposal is still sent and
// its link returned with no email, and a delivery reminder refuses
// `daily_email_cap_reached` with no audit row and no send. The session and
// Resend are replaced; the cores and the counts run on the seeded database.

const holder = vi.hoisted(() => ({ ctx: null as OrgContext | null, sends: [] as Array<{ to: unknown }> }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: async () => holder.ctx }));
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
process.env.RESEND_FROM = 'quotes@metra.test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.metra.test';

const { sendProposal } = await import('@/lib/proposals/actions');

const SECRET = 'daily-cap-dbtest-secret-0123456789abcdef0123456789';
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

async function draftProposalForClientWithEmail() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  holder.ctx = ctx;
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme', email: 'client@buyer.test' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, { startDate: '2026-01-01', endDate: '2026-06-30', code: 'PRJ-1', nameEn: 'Tower', clientId: client.id, status: 'active' });
  const [project] = await listProjects(ctx, {});
  const id = ((await createProposalCore(ctx, { clientId: client.id, projectId: project.id })) as { data?: string }).data!;
  await saveProposalDraftCore(ctx, {
    id,
    header: { taxRate: '14', supervisionPct: '0' },
    sections: [{ titleEn: 'S', lines: [{ descriptionEn: 'x', qty: '1', unit: 'sqm', unitCost: '50', unitPrice: '100', discountPct: '0' }] }],
  });
  return { orgId, ownerId: ownerIds[0], id };
}

async function deliveryWithClientEmail(suffix: string) {
  const delivery = await seedRoundBDelivery(orgIds, suffix);
  await raw.query(
    `update public.clients set email = 'client@example.com'
      where id = (select client_id from public.design_engagements where id = '${delivery.engagementId}')`,
  );
  return delivery;
}

const REMINDER_ROW = { entity: 'design_engagement', action: 'issue', after: { revealed: true, reminder: 'email' } } as const;

describe('the daily client email cap', () => {
  it('at 60 client emails a proposal is still sent and its link returned, with no email', async () => {
    const { orgId, ownerId, id } = await draftProposalForClientWithEmail();
    await seedSentProposalEvents(orgId, id, 30);
    await seedAuditRows(orgId, ownerId, 30, REMINDER_ROW);
    const answer = await sendProposal(id);
    expect(answer).toEqual({ ok: true, link: expect.stringContaining('/p/'), emailSent: false, emailSkippedNoAddress: false });
    const [proposal] = await raw.query<{ status: string }>(`select status from public.proposals where id = '${id}'`);
    expect(proposal.status).toBe('sent');
    expect(holder.sends).toHaveLength(0);
  });

  it('at 60 client emails a delivery reminder refuses, writes no audit row and sends nothing', async () => {
    const delivery = await deliveryWithClientEmail('cap-reached');
    await seedAuditRows(delivery.orgId, delivery.ownerId, 60, REMINDER_ROW);
    const auditBefore = await auditRowCount(delivery.orgId, 'design_engagement');
    expect(await emailDeliveryReminderCore(delivery.ctx, { engagementId: delivery.engagementId, locale: 'en' }, ORIGIN)).toEqual({
      ok: false,
      error: 'daily_email_cap_reached',
    });
    expect(await auditRowCount(delivery.orgId, 'design_engagement')).toBe(auditBefore);
    expect(holder.sends).toHaveLength(0);
  });

  it('under the cap the same reminder goes out', async () => {
    const delivery = await deliveryWithClientEmail('cap-under');
    await seedAuditRows(delivery.orgId, delivery.ownerId, 59, REMINDER_ROW);
    expect(await emailDeliveryReminderCore(delivery.ctx, { engagementId: delivery.engagementId, locale: 'en' }, ORIGIN)).toEqual({ ok: true });
    expect(holder.sends.map((sent) => sent.to)).toEqual(['client@example.com']);
  });
});
