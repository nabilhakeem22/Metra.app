import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getDeliveryByToken } from '@/lib/engagements/public';
import { recordPaymentCore } from '@/lib/engagements/payments';
import {
  mintDeliveryLinkCore,
  revokeDeliveryLinkCore,
  rotateDeliveryLinkCore,
} from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Substrings that must NEVER appear anywhere in the client snapshot JSON. */
const FORBIDDEN = [
  'cost',
  'margin',
  'token_hash',
  'render_manifest',
  'supervision',
  'revision_count',
  'free_revision',
  'as_built',
  'concept_locked',
];

function hashOf(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Seed an org + client + project + ONE engagement WITH a fee schedule + deposit. */
async function seedDelivery(suffix = 'a'): Promise<{
  ctx: OrgContext;
  engagementId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: `Acme ${suffix}` });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;

  // Set a fee schedule (moves to design_proposal) so the payment schedule exists.
  await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: {
      designFee: '100000',
      milestones: [
        { kind: 'deposit', basis: 'percent', value: '25' },
        { kind: 'gate_a', basis: 'percent', value: '25' },
        { kind: 'gate_b', basis: 'percent', value: '25' },
        { kind: 'balance', basis: 'percent', value: '25' },
      ],
    },
  });
  // Record a deposit payment so a milestone reads 'paid'.
  await recordPaymentCore(ctx, {
    engagementId,
    kind: 'deposit',
    amount: '25000',
  });

  return { ctx, engagementId };
}

describe('delivery portal — cost-safe token snapshot', () => {
  it('a valid token resolves the firm-branded snapshot with NO cost/margin key', async () => {
    const { ctx, engagementId } = await seedDelivery('valid');
    const minted = await mintDeliveryLinkCore(ctx, engagementId);
    expect(minted.ok).toBe(true);
    const token = minted.data!;

    // Direct SDF jsonb — the strongest cost-safety proof (grep the raw snapshot).
    const [{ data }] = await raw.query<{ data: unknown }>(
      `select public.app_delivery_by_token('${hashOf(token)}') as data`,
    );
    expect(data).not.toBeNull();
    const rawJson = JSON.stringify(data);
    for (const needle of FORBIDDEN) {
      expect(rawJson.includes(needle)).toBe(false);
    }

    // Mapped surface — the shape the portal renders.
    const delivery = await getDeliveryByToken(token);
    expect(delivery).not.toBeNull();
    expect(delivery!.number).toBeGreaterThan(0);
    // Raw machine state must NOT be on the client-facing shape (S1); the mapped
    // friendly label is what the portal renders.
    expect((delivery as unknown as { state?: unknown }).state).toBeUndefined();
    expect(delivery!.stageLabel.en).toBeTruthy();
    expect(delivery!.firm.nameEn).toBe('Test Org');
    expect(delivery!.designFeeTotal).toBe('100000.0000');
    expect(delivery!.paymentSchedule.length).toBe(4);

    const deposit = delivery!.paymentSchedule.find(
      (r) => r.milestone_kind === 'deposit',
    )!;
    expect(deposit.amount_due).toBe('25000.0000');
    expect(deposit.amount_cleared).toBe('25000.0000');
    expect(deposit.status).toBe('paid');

    const gateA = delivery!.paymentSchedule.find(
      (r) => r.milestone_kind === 'gate_a',
    )!;
    expect(gateA.status).toBe('due');
    expect(gateA.amount_cleared).toBe('0.0000');

    // The mapped object must also be cost-free.
    const mappedJson = JSON.stringify(delivery);
    for (const needle of FORBIDDEN) {
      expect(mappedJson.includes(needle)).toBe(false);
    }
  });

  it('an unknown token resolves to null', async () => {
    const delivery = await getDeliveryByToken('this-token-was-never-minted');
    expect(delivery).toBeNull();
  });

  it('a revoked token 404s (resolves to null)', async () => {
    const { ctx, engagementId } = await seedDelivery('revoke');
    const minted = await mintDeliveryLinkCore(ctx, engagementId);
    const token = minted.data!;
    expect(await getDeliveryByToken(token)).not.toBeNull();

    const revoked = await revokeDeliveryLinkCore(ctx, engagementId);
    expect(revoked.ok).toBe(true);
    expect(await getDeliveryByToken(token)).toBeNull();
  });

  it('rotate kills the old token and issues a fresh one', async () => {
    const { ctx, engagementId } = await seedDelivery('rotate');
    const first = await mintDeliveryLinkCore(ctx, engagementId);
    const oldToken = first.data!;
    const rotated = await rotateDeliveryLinkCore(ctx, engagementId);
    expect(rotated.ok).toBe(true);
    const newToken = rotated.data!;

    expect(newToken).not.toBe(oldToken);
    expect(await getDeliveryByToken(oldToken)).toBeNull();
    expect(await getDeliveryByToken(newToken)).not.toBeNull();
  });

  it('an expired link resolves to null', async () => {
    const { ctx, engagementId } = await seedDelivery('expired');
    const minted = await mintDeliveryLinkCore(ctx, engagementId);
    const token = minted.data!;
    // Force an expiry in the past over the BYPASSRLS connection.
    await raw.query(
      `update public.design_engagements
         set share_expires_at = now() - interval '1 day'
       where id = '${engagementId}'`,
    );
    expect(await getDeliveryByToken(token)).toBeNull();
  });

  it("token A never resolves delivery B (cross-delivery isolation)", async () => {
    const a = await seedDelivery('cross-a');
    const b = await seedDelivery('cross-b');
    const tokenA = (await mintDeliveryLinkCore(a.ctx, a.engagementId)).data!;
    const tokenB = (await mintDeliveryLinkCore(b.ctx, b.engagementId)).data!;

    const resolvedA = await getDeliveryByToken(tokenA);
    const resolvedB = await getDeliveryByToken(tokenB);
    expect(resolvedA!.id).toBe(a.engagementId);
    expect(resolvedB!.id).toBe(b.engagementId);
    expect(resolvedA!.id).not.toBe(resolvedB!.id);
  });

  it('mint refuses a second link once one is live (rotate to replace)', async () => {
    const { ctx, engagementId } = await seedDelivery('double-mint');
    const first = await mintDeliveryLinkCore(ctx, engagementId);
    expect(first.ok).toBe(true);
    const second = await mintDeliveryLinkCore(ctx, engagementId);
    expect(second).toEqual({ ok: false, error: 'invalid' });
  });

  it('a non-owner/admin role cannot mint a link', async () => {
    const { orgId, ownerIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'project_manager' }],
    });
    orgIds.push(orgId);
    const owner = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(owner, { nameEn: 'Acme pm' });
    const [client] = await listClients(owner, {});
    await createProjectCore(owner, {
      code: `PRJ-${orgId.slice(0, 8)}`,
      nameEn: 'Tower',
      clientId: client.id,
      status: 'active',
    });
    const [project] = await listProjects(owner, {});
    const created = await createEngagementCore(owner, {
      titleEn: 'Villa',
      clientId: client.id,
      projectId: project.id,
    });
    const engagementId = (created as { data?: string }).data!;

    const [pmId] = (await raw.memberships(orgId))
      .filter((m) => m.role === 'project_manager')
      .map((m) => m.user_id);
    const pm = ctxFor(orgId, pmId, 'project_manager');
    const res = await mintDeliveryLinkCore(pm, engagementId);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});
