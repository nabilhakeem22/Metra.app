import { afterAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordOfflineApprovalCore, type OfflineApprovalInput } from '@/lib/engagements/offline-approval-core';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { issueRomCore } from '@/lib/engagements/rom-issue';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// "Client approved offline" (round B, C5 + the Oct 7 owner decision): the role
// fence (owner, admin, project manager), then the normal forward trigger with
// the approval's provenance as its payload. Same guards and codes as Advance;
// the staff approval row carries the channel, the date and the note.

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

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cairo days, as the server compares them. The rounds below start "now". */
const today = () => todayInCairo(new Date());
const yesterday = () => todayInCairo(new Date(Date.now() - DAY_MS));
const tomorrow = () => todayInCairo(new Date(Date.now() + DAY_MS));

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

function approveOffline(ctx: OrgContext, engagementId: string, approval: OfflineApprovalInput) {
  return recordOfflineApprovalCore(ctx, { engagementId, trigger: 'approveDesign', approval });
}

/** The studio's own Advance: the trigger with no payload. */
async function advance(ctx: OrgContext, engagementId: string, trigger: 'selectConcept'): Promise<void> {
  expect((await executeTransition(ctx, { engagementId, trigger })).ok).toBe(true);
}

interface Seeded {
  ctx: OrgContext;
  /** A site engineer of the same org: advances stages, may not stand in for the client. */
  engineer: OrgContext;
  engagementId: string;
}

/** One engagement driven to concept_review (deposit, survey, two options). */
async function seedConceptReview(): Promise<Seeded> {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: [{ role: 'site_engineer' }],
  });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  const engineer = ctxFor(orgId, memberIds[0], 'site_engineer');
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
  return { ctx, engineer, engagementId };
}

/** The same, on to final_approval with the ROM acknowledged (gate_b still unpaid). */
async function seedFinalApproval(): Promise<Seeded> {
  const seeded = await seedConceptReview();
  const { ctx, engagementId } = seeded;
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
  return seeded;
}

describe('Client approved offline at final_approval', () => {
  it('moves the delivery as Advance would, and the row carries channel, date, note and actor', async () => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    const res = await approveOffline(ctx, engagementId, {
      channel: 'phone',
      occurredOn: today(),
      note: 'Approved on a call',
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await approvalRows(engagementId, 'design_approval')).toEqual([
      {
        actor_channel: 'staff',
        actor_user_id: ctx.userId,
        evidence: 'phone',
        occurred_on: today(),
        note: 'Approved on a call',
      },
    ]);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(1);
  });

  it('a replay never advances twice nor writes a second approval', async () => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
    expect((await approveOffline(ctx, engagementId, { channel: 'phone' })).ok).toBe(true);

    const replay = await approveOffline(ctx, engagementId, { channel: 'phone' });
    expect(replay.ok).toBe(false);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await approvalRows(engagementId, 'design_approval')).toHaveLength(1);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(1);
  });

  it('a site engineer is refused before anything is read or written', async () => {
    const { ctx, engineer, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    expect(await approveOffline(engineer, engagementId, { channel: 'phone' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    // The executor's own fence holds too, for a caller that skips the core.
    expect(
      await executeTransition(engineer, {
        engagementId,
        trigger: 'approveDesign',
        payload: { channel: 'phone' },
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await approvalRows(engagementId, 'design_approval')).toHaveLength(0);
  });

  it("another org's delivery reads as not found and nothing moves", async () => {
    const { engagementId, ctx } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
    const { orgId: otherOrg, ownerIds: otherOwners } = await seedOrg({ owners: 1 });
    orgIds.push(otherOrg);

    const res = await approveOffline(ctxFor(otherOrg, otherOwners[0], 'owner'), engagementId, {
      channel: 'phone',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await approvalRows(engagementId, 'design_approval')).toHaveLength(0);
  });

  it.each([
    ['before the round under review', yesterday],
    ['after today', tomorrow],
  ])('a date %s is out of range: no transition, no row', async (_label, day) => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    const res = await approveOffline(ctx, engagementId, { channel: 'phone', occurredOn: day() });
    expect(res).toEqual({ ok: false, error: 'offline_approval_date_out_of_range' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await approvalRows(engagementId, 'design_approval')).toHaveLength(0);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(0);
  });

  it('a note over the cap is named, not "try again"', async () => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
    expect(await approveOffline(ctx, engagementId, { channel: 'phone', note: 'x'.repeat(2001) })).toEqual({
      ok: false,
      error: 'offline_approval_note_too_long',
    });
    expect(await stateOf(engagementId)).toBe('final_approval');
  });

  it('an unmet payment guard answers with its own code, exactly as Advance does', async () => {
    const { ctx, engagementId } = await seedFinalApproval();

    const res = await approveOffline(ctx, engagementId, { channel: 'whatsapp' });
    expect(res).toEqual({ ok: false, error: 'gate_b_not_cleared' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await approvalRows(engagementId, 'design_approval')).toHaveLength(0);
  });

  it('an unknown channel, or an option choice before the picker exists, is invalid', async () => {
    const { ctx, engagementId } = await seedFinalApproval();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
    for (const approval of [
      { channel: 'fax' },
      { channel: 'phone', chosenArtifactId: '11111111-1111-4111-8111-111111111111' },
    ]) {
      expect(await approveOffline(ctx, engagementId, approval)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await stateOf(engagementId)).toBe('final_approval');
  });
});

describe('Client approved offline at concept_review', () => {
  it('selects the concept with the channel on the staff concept_approval row', async () => {
    const { ctx, engagementId } = await seedConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });

    const res = await recordOfflineApprovalCore(ctx, {
      engagementId,
      trigger: 'selectConcept',
      approval: { channel: 'whatsapp', occurredOn: today() },
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    const [row] = await approvalRows(engagementId, 'concept_approval');
    expect(row).toMatchObject({ actor_channel: 'staff', evidence: 'whatsapp', occurred_on: today() });
  });

  it('a date before the delivery entered concept review is out of range', async () => {
    const { ctx, engagementId } = await seedConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
    expect(
      await recordOfflineApprovalCore(ctx, {
        engagementId,
        trigger: 'selectConcept',
        approval: { channel: 'phone', occurredOn: yesterday() },
      }),
    ).toEqual({ ok: false, error: 'offline_approval_date_out_of_range' });
    expect(await stateOf(engagementId)).toBe('concept_review');
  });

  it('the studio Advance (no payload) still writes a plain approval, and a site engineer may still Advance', async () => {
    const { ctx, engineer, engagementId } = await seedConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
    await advance(engineer, engagementId, 'selectConcept');
    const [row] = await approvalRows(engagementId, 'concept_approval');
    expect(row).toMatchObject({ actor_channel: 'staff', evidence: null, occurred_on: null });
  });
});
