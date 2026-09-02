import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordHandoffAcknowledgementCore } from '@/lib/engagements/handoff';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import {
  TRANSITIONS,
  type GenerateFeeSchedulePayload,
  type Trigger,
} from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

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

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function ackRows(engagementId: string) {
  return raw.query<{ actor_channel: string; note: string | null }>(
    `select actor_channel, note from public.engagement_events
      where engagement_id = '${engagementId}' and kind = 'handoff_acknowledgement'
      order by decided_at`,
  );
}

/**
 * Seed an org (owner + admin + PM members) and drive ONE engagement through the
 * FULL wired walk via executeTransition only, up to `execution_decision`:
 * submitDesignFee -> deposit -> survey -> layout -> options -> gate_a ->
 * selectConcept -> confirmConcept -> render -> rendersReady -> ROM ack ->
 * gate_b -> approveDesign -> shop_drawing -> draftReady -> boq -> finalizeBOQ.
 */
async function setupExecutionDecision(): Promise<{
  orgId: string;
  ctx: OrgContext;
  memberIds: string[];
  engagementId: string;
}> {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: [{ role: 'admin' }, { role: 'project_manager' }],
  });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
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
  await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: FEE,
  });
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' });
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  await executeTransition(ctx, { engagementId, trigger: 'optionsReady' });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  await executeTransition(ctx, { engagementId, trigger: 'selectConcept' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmConcept' });
  await recordArtifactCore(ctx, {
    engagementId,
    kind: 'approved_render',
    contentHash: 'hash-alpha',
  });
  await executeTransition(ctx, { engagementId, trigger: 'rendersReady' });
  await setEngagementRomCore(ctx, {
    engagementId,
    romLow: '500000',
    romHigh: '800000',
  });
  await recordRomAcknowledgementCore(ctx, { engagementId });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
  await executeTransition(ctx, { engagementId, trigger: 'approveDesign' });
  await recordArtifactCore(ctx, { engagementId, kind: 'shop_drawing' });
  await executeTransition(ctx, { engagementId, trigger: 'draftReady' });
  await recordArtifactCore(ctx, { engagementId, kind: 'boq' });
  await executeTransition(ctx, { engagementId, trigger: 'finalizeBOQ' });
  expect(await stateOf(engagementId)).toBe('execution_decision');
  return { orgId, ctx, memberIds, engagementId };
}

/** Continue an execution_decision engagement into design_only_handoff. */
async function intoHandoff(ctx: OrgContext, engagementId: string): Promise<void> {
  await recordPaymentCore(ctx, { engagementId, kind: 'balance', amount: '30000' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'chooseDesignOnly' })).ok,
  ).toBe(true);
  expect(await stateOf(engagementId)).toBe('design_only_handoff');
}

describe('recipientAcknowledges — the handoff-acknowledgement gate', () => {
  it('with NO acknowledgement: handoff_not_acknowledged, state unchanged', async () => {
    const { ctx, engagementId } = await setupExecutionDecision();
    await intoHandoff(ctx, engagementId);

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'recipientAcknowledges',
    });
    expect(res).toEqual({ ok: false, error: 'handoff_not_acknowledged' });
    expect(await stateOf(engagementId)).toBe('design_only_handoff');
  });

  it('the CLIENT-channel token ack (acknowledge_handoff) satisfies the guard', async () => {
    const { ctx, engagementId } = await setupExecutionDecision();
    const minted = await mintDeliveryLinkCore(ctx, engagementId);
    const token = minted.data!;
    await intoHandoff(ctx, engagementId);

    // The client acknowledges via the P2 token path — the exact SDF action string.
    const ack = await recordDeliveryActionByToken(token, {
      action: 'acknowledge_handoff',
    });
    expect(ack).toEqual({ ok: true });
    const rows = await ackRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_channel).toBe('client');

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'recipientAcknowledges',
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('closed_design_only');
  });

  it('the STAFF stand-in (recordHandoffAcknowledgementCore) satisfies it too, note trimmed', async () => {
    const { ctx, engagementId } = await setupExecutionDecision();
    await intoHandoff(ctx, engagementId);

    const ack = await recordHandoffAcknowledgementCore(ctx, {
      engagementId,
      note: '  received on site  ',
    });
    expect(ack.ok).toBe(true);
    const rows = await ackRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_channel).toBe('staff');
    expect(rows[0].note).toBe('received on site');

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'recipientAcknowledges',
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('closed_design_only');
  });

  it('staff ack in the WRONG state: handoff_not_open, nothing written', async () => {
    const { ctx, engagementId } = await setupExecutionDecision();
    // Still at execution_decision — no design-only package is out.
    const res = await recordHandoffAcknowledgementCore(ctx, { engagementId });
    expect(res).toEqual({ ok: false, error: 'handoff_not_open' });
    expect(await ackRows(engagementId)).toHaveLength(0);
  });

  it('only owner/admin fire recipientAcknowledges (engagements_issue, approve)', async () => {
    const { orgId, ctx, memberIds, engagementId } = await setupExecutionDecision();
    await intoHandoff(ctx, engagementId);
    await recordHandoffAcknowledgementCore(ctx, { engagementId });

    const [adminId, pmId] = memberIds;
    // A PM may drive design triggers but never the issue family.
    expect(
      await executeTransition(ctxFor(orgId, pmId, 'project_manager'), {
        engagementId,
        trigger: 'recipientAcknowledges',
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(await stateOf(engagementId)).toBe('design_only_handoff');

    // An admin closes it.
    const res = await executeTransition(ctxFor(orgId, adminId, 'admin'), {
      engagementId,
      trigger: 'recipientAcknowledges',
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('closed_design_only');
  });
});

describe('FULL WALK — both endings reached via executeTransition only; terminals are inert', () => {
  it('created -> … -> execution AND created -> … -> closed_design_only; both then reject every trigger and every write', async () => {
    // Ending 1: full execution.
    const a = await setupExecutionDecision();
    await recordPaymentCore(a.ctx, {
      engagementId: a.engagementId,
      kind: 'balance',
      amount: '30000',
    });
    expect(
      (
        await executeTransition(a.ctx, {
          engagementId: a.engagementId,
          trigger: 'chooseExecution',
        })
      ).ok,
    ).toBe(true);
    expect(await stateOf(a.engagementId)).toBe('execution');

    // Ending 2: design-only close.
    const b = await setupExecutionDecision();
    await intoHandoff(b.ctx, b.engagementId);
    await recordHandoffAcknowledgementCore(b.ctx, { engagementId: b.engagementId });
    expect(
      (
        await executeTransition(b.ctx, {
          engagementId: b.engagementId,
          trigger: 'recipientAcknowledges',
        })
      ).ok,
    ).toBe(true);
    expect(await stateOf(b.engagementId)).toBe('closed_design_only');

    // Both terminals reject EVERY declared trigger: no terminal state is in any
    // trigger's from-set, so the executor answers illegal_trigger before guards.
    const allTriggers = Object.keys(TRANSITIONS) as Trigger[];
    for (const terminal of [a, b]) {
      for (const trigger of allTriggers) {
        const res = await executeTransition(terminal.ctx, {
          engagementId: terminal.engagementId,
          trigger,
        });
        expect(res, `${trigger} must be illegal from a terminal`).toEqual({
          ok: false,
          error: 'illegal_trigger',
        });
      }
    }
    expect(await stateOf(a.engagementId)).toBe('execution');
    expect(await stateOf(b.engagementId)).toBe('closed_design_only');

    // …and reject every write (the isTerminal fence in each data-entry core).
    for (const terminal of [a, b]) {
      expect(
        await recordPaymentCore(terminal.ctx, {
          engagementId: terminal.engagementId,
          kind: 'balance',
          amount: '1',
        }),
      ).toEqual({ ok: false, error: 'engagement_not_active' });
      expect(
        await recordArtifactCore(terminal.ctx, {
          engagementId: terminal.engagementId,
          kind: 'boq',
        }),
      ).toEqual({ ok: false, error: 'engagement_not_active' });
      expect(
        await recordHandoffAcknowledgementCore(terminal.ctx, {
          engagementId: terminal.engagementId,
        }),
      ).toEqual({ ok: false, error: 'engagement_not_active' });
      expect(
        await setEngagementRomCore(terminal.ctx, {
          engagementId: terminal.engagementId,
          romLow: '1',
          romHigh: '2',
        }),
      ).toEqual({ ok: false, error: 'engagement_not_active' });
    }
  });
});
