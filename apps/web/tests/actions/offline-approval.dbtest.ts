import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { issueRomCore } from '@/lib/engagements/rom-issue';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// "Client approved offline" (round B, C5): the normal forward trigger with the
// approval's provenance as its payload. Same guards and codes as Advance; the
// staff approval row carries the channel, the date and the note.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const FEE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

const PAST_DAY = '2026-01-15';

function tomorrowIso(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

interface ApprovalRow {
  actor_channel: string;
  actor_user_id: string | null;
  evidence: string | null;
  occurred_on: string | null;
  note: string | null;
}

async function approvalRows(engagementId: string, kind: string): Promise<ApprovalRow[]> {
  return raw.query<ApprovalRow>(
    `select actor_channel, actor_user_id, evidence, occurred_on::text as occurred_on, note
       from public.engagement_events
      where engagement_id = '${engagementId}' and kind = '${kind}'`,
  );
}

async function transitionCount(engagementId: string, trigger: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
      where engagement_id = '${engagementId}' and trigger = '${trigger}'`,
  );
  return Number(row.n);
}

/** The studio's own Advance: the trigger with no payload. */
async function advance(ctx: OrgContext, engagementId: string, trigger: 'selectConcept'): Promise<void> {
  expect((await executeTransition(ctx, { engagementId, trigger })).ok).toBe(true);
}

/** One engagement driven to concept_review (deposit, survey, two options). */
async function seedConceptReview(): Promise<{ ctx: OrgContext; engagementId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
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
  const run = async (trigger: Parameters<typeof executeTransition>[1]['trigger'], payload?: unknown) =>
    expect((await executeTransition(ctx, { engagementId, trigger, payload })).ok).toBe(true);
  await run('submitDesignFee', FEE);
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  await run('confirmAndPayDeposit');
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  await run('spatialBaseReady');
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  await run('optionsReady');
  expect(await stateOf(engagementId)).toBe('concept_review');
  return { ctx, engagementId };
}

/** The same, on to final_approval with the ROM acknowledged (gate_b still unpaid). */
async function seedFinalApproval(): Promise<{ ctx: OrgContext; engagementId: string }> {
  const { ctx, engagementId } = await seedConceptReview();
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  await advance(ctx, engagementId, 'selectConcept');
  expect((await executeTransition(ctx, { engagementId, trigger: 'confirmConcept' })).ok).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'approved_render', contentHash: 'hash-alpha' });
  await recordArtifactCore(ctx, { engagementId, kind: 'approved_render', contentHash: 'hash-beta' });
  expect((await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok).toBe(true);
  expect((await setEngagementRomCore(ctx, { engagementId, romLow: '500000', romHigh: '800000' })).ok).toBe(true);
  expect((await issueRomCore(ctx, { engagementId })).ok).toBe(true);
  expect((await recordRomAcknowledgementCore(ctx, { engagementId })).ok).toBe(true);
  expect(await stateOf(engagementId)).toBe('final_approval');
  return { ctx, engagementId };
}

describe('Client approved offline at final_approval', () => {
  it('moves the delivery as Advance would, and the row carries channel, date, note and actor', async () => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'approveDesign',
      payload: { channel: 'phone', occurredOn: PAST_DAY, note: 'Approved on a call' },
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await approvalRows(engagementId, 'design_approval')).toEqual([
      {
        actor_channel: 'staff',
        actor_user_id: ctx.userId,
        evidence: 'phone',
        occurred_on: PAST_DAY,
        note: 'Approved on a call',
      },
    ]);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(1);
  });

  it('a future date is invalid: no transition, no row', async () => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'approveDesign',
      payload: { channel: 'phone', occurredOn: tomorrowIso() },
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await approvalRows(engagementId, 'design_approval')).toHaveLength(0);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(0);
  });

  it('an unmet payment guard answers with its own code, exactly as Advance does', async () => {
    const { ctx, engagementId } = await seedFinalApproval();

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'approveDesign',
      payload: { channel: 'whatsapp' },
    });
    expect(res).toEqual({ ok: false, error: 'gate_b_not_cleared' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await approvalRows(engagementId, 'design_approval')).toHaveLength(0);
  });

  it('an unknown channel, or an option choice before the picker exists, is invalid', async () => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
    for (const payload of [
      { channel: 'fax' },
      { channel: 'phone', chosenArtifactId: '11111111-1111-4111-8111-111111111111' },
    ]) {
      expect(await executeTransition(ctx, { engagementId, trigger: 'approveDesign', payload })).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    expect(await stateOf(engagementId)).toBe('final_approval');
  });
});

describe('Client approved offline at concept_review', () => {
  it('selects the concept with the channel on the staff concept_approval row', async () => {
    const { ctx, engagementId } = await seedConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'selectConcept',
      payload: { channel: 'whatsapp' },
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    const [row] = await approvalRows(engagementId, 'concept_approval');
    expect(row).toMatchObject({ actor_channel: 'staff', evidence: 'whatsapp', occurred_on: null, note: null });
  });

  it('the studio Advance (no payload) still writes a plain approval', async () => {
    const { ctx, engagementId } = await seedConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
    await advance(ctx, engagementId, 'selectConcept');
    const [row] = await approvalRows(engagementId, 'concept_approval');
    expect(row).toMatchObject({ actor_channel: 'staff', evidence: null, occurred_on: null });
  });
});
