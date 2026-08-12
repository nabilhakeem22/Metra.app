import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { createProposalCore, saveProposalDraftCore } from '@/lib/proposals/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// The action wrapper hits requireOrg (session), next/cache and Resend — all of
// which we stub. sendProposalCore itself runs for real against the test DB.
const holder = vi.hoisted(() => ({
  ctx: null as OrgContext | null,
  sends: [] as Array<Record<string, unknown>>,
  behavior: 'ok' as 'ok' | 'error' | 'throw',
}));

vi.mock('@/lib/auth/require-org', () => ({
  requireOrg: async () => holder.ctx,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        holder.sends.push(payload);
        if (holder.behavior === 'throw') throw new Error('resend down');
        return holder.behavior === 'error'
          ? { error: { message: 'bad' } }
          : { error: null };
      },
    };
  },
}));

// Resend keys present so sendProposalEmail attempts to send (hits the mock).
process.env.RESEND_API_KEY = 'test-key';
process.env.RESEND_FROM = 'quotes@metra.test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.metra.test';

// Import AFTER mocks are registered.
const { sendProposal } = await import('@/lib/proposals/actions');

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => {
  holder.sends = [];
  holder.behavior = 'ok';
});

async function makeSentReadyProposal(clientEmail: string | null) {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  holder.ctx = ctx;

  await createClientCore(ctx, { nameEn: 'Acme', email: clientEmail });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const id = (
    (await createProposalCore(ctx, {
      clientId: client.id,
      projectId: project.id,
    })) as { data?: string }
  ).data!;
  await saveProposalDraftCore(ctx, {
    id,
    header: { taxRate: '14', supervisionPct: '0' },
    sections: [
      {
        titleEn: 'S',
        lines: [
          { descriptionEn: 'x', qty: '1', unit: 'sqm', unitCost: '50', unitPrice: '100', discountPct: '0' },
        ],
      },
    ],
  });
  return { orgId, id };
}

describe('sendProposal — emails the client (best-effort)', () => {
  it('AC8: client has email -> {ok, link, emailSent:true}; Resend gets a /p/<token> link and NO cost/margin', async () => {
    const { id } = await makeSentReadyProposal('client@buyer.test');
    const res = await sendProposal(id);
    expect(res.ok).toBe(true);
    expect(res.link).toMatch(/\/p\/[A-Za-z0-9_-]+$/);
    expect(res.emailSent).toBe(true);
    expect(res.emailSkippedNoAddress).toBeFalsy();

    expect(holder.sends).toHaveLength(1);
    const sent = holder.sends[0];
    expect(sent.to).toBe('client@buyer.test');
    const blob = `${sent.subject} ${sent.html} ${sent.text}`;
    // The email carries the accept link and never leaks cost/margin. The
    // cost/margin word check runs on the plain-text body (the HTML's inline CSS
    // legitimately contains "margin").
    expect(String(sent.html)).toContain('/p/');
    const visible = `${sent.subject} ${sent.text}`.toLowerCase();
    expect(visible).not.toContain('cost');
    expect(visible).not.toContain('margin');
    expect(`${sent.subject} ${sent.text}`).not.toContain('تكلفة');
    expect(`${sent.subject} ${sent.text}`).not.toContain('هامش');
    // No Arabic-Indic digits (§4.1).
    expect(/[٠-٩۰-۹]/.test(blob)).toBe(false);
  });

  it('AC9: client has no email -> {ok, link, emailSent:false, emailSkippedNoAddress:true}; proposal still sent (event exists)', async () => {
    const { orgId, id } = await makeSentReadyProposal(null);
    const res = await sendProposal(id);
    expect(res.ok).toBe(true);
    expect(res.link).toBeTruthy();
    expect(res.emailSent).toBe(false);
    expect(res.emailSkippedNoAddress).toBe(true);
    expect(holder.sends).toHaveLength(0);

    const events = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.proposal_events where org_id='${orgId}' and kind='sent'`,
    );
    expect(events[0].n).toBe(1);
    const status = await raw.query<{ status: string }>(
      `select status from public.proposals where id='${id}'`,
    );
    expect(status[0].status).toBe('sent');
  });

  it('AC10: Resend failure -> {ok, emailSent:false}; proposal still sent (no rollback), token never returned raw beyond the link', async () => {
    holder.behavior = 'throw';
    const { id } = await makeSentReadyProposal('client@buyer.test');
    const res = await sendProposal(id);
    expect(res.ok).toBe(true);
    expect(res.emailSent).toBe(false);
    const status = await raw.query<{ status: string }>(
      `select status from public.proposals where id='${id}'`,
    );
    expect(status[0].status).toBe('sent');
  });

  it('Resend returns an error object -> emailSent:false, still ok', async () => {
    holder.behavior = 'error';
    const { id } = await makeSentReadyProposal('client@buyer.test');
    const res = await sendProposal(id);
    expect(res.ok).toBe(true);
    expect(res.emailSent).toBe(false);
    expect(holder.sends).toHaveLength(1);
  });
});
