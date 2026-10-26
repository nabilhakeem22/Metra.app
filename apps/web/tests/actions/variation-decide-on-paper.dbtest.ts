import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemberRole } from '@metra/db';
import { todayInCairo } from '@/lib/automation/clock';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { OrgContext } from '@/lib/db/context';
import { issueVariationRequestCore } from '@/lib/execution/requests/issue-variation';
import { mintShareToken } from '@/lib/share/token';
import { recordVariationDecisionOnPaperCore } from '@/lib/variations/core';
import { variationDecidedKey } from '@/lib/variations/decided-message';
import { getVariationByToken } from '@/lib/variations/public';
import { listVariations } from '@/lib/variations/queries';
import { variationStatusKey } from '@/lib/variations/status-label';
import { seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedVariation, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// H7.3, AC 32: the studio records a change order's client decision made on
// paper. Owner, admin or project manager only; issued -> approved | rejected
// with one staff event marked recorded_on_paper; an approval is billable.

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['admin', 'project_manager', 'site_engineer', 'accountant', 'viewer'];
const TODAY = todayInCairo(new Date());

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: ROLES.map((role) => ({ role })) });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  ctx.owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  ROLES.forEach((role, index) => (ctx[role] = ctxFor(orgId, seeded.memberIds[index], role)));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

interface DecisionEvent {
  kind: string;
  channel: string | null;
  paper: boolean;
  actor: string | null;
  day: string;
}

const statusOf = async (id: string) =>
  (await ownerQuery<{ status: string }>(`select status::text from public.variation_orders where id = $1`, [id]))[0].status;

/** Every approved / rejected event of the order. */
const decisionsOf = (id: string) =>
  ownerQuery<DecisionEvent>(
    `select kind, actor_channel as channel, recorded_on_paper as paper, actor_user_id::text as actor,
            to_char(decided_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day
       from public.variation_order_events
      where variation_order_id = $1 and kind in ('approved', 'rejected')`,
    [id],
  );

/** The order's `issued` event at `at` (a timestamptz literal): what issueVariationCore writes. */
async function issuedAt(variationOrderId: string, at: string): Promise<void> {
  await ownerQuery(
    `insert into public.variation_order_events (org_id, variation_order_id, kind, actor_channel, from_status, to_status, decided_at)
     values ($1, $2, 'issued', 'staff', 'internal_approved', 'issued', $3::timestamptz)`,
    [orgId, variationOrderId, at],
  );
}

async function issuedOrder(contractState: 'issued' | 'signed' = 'signed') {
  const contract = await seedExecutionContract(orgId, { state: contractState });
  const token = mintShareToken();
  const order = await seedVariation(orgId, contract, 'issued', { tokenHash: token.hash });
  await issuedAt(order.id, '2026-09-28 11:00+03');
  return { contract, order, rawToken: token.raw };
}

describe('recordVariationDecisionOnPaperCore', () => {
  it('approves: one staff event on paper, the day and who recorded it, the note in the audit log, and it is billable', async () => {
    const { order } = await issuedOrder();
    const res = await recordVariationDecisionOnPaperCore(ctx.owner!, {
      variationOrderId: order.id,
      decision: 'approve',
      decidedOn: '2026-10-01',
      note: 'Signed at the site office',
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await statusOf(order.id)).toBe('approved');
    expect(await decisionsOf(order.id)).toEqual([
      { kind: 'approved', channel: 'staff', paper: true, actor: ctx.owner!.userId, day: '2026-10-01' },
    ]);
    const [audit] = await ownerQuery<{ after: Record<string, unknown> }>(
      `select after from public.audit_log where entity = 'variation_order' and entity_id = $1 and action = 'update'`,
      [order.id],
    );
    expect(audit.after).toEqual({
      status: 'approved',
      decided_on: '2026-10-01',
      decided_on_paper: true,
      note: 'Signed at the site office',
    });
    const billed = await issueVariationRequestCore(ctx.owner!, { variationOrderId: order.id });
    expect(billed).toMatchObject({ ok: true });
  });

  it('rejects, and the register and the client page read it as the client refusal, never the termination', async () => {
    const { contract, order, rawToken } = await issuedOrder();
    expect(
      await recordVariationDecisionOnPaperCore(ctx.project_manager!, { variationOrderId: order.id, decision: 'reject', decidedOn: TODAY }),
    ).toMatchObject({ ok: true });
    expect(await statusOf(order.id)).toBe('rejected');
    expect(await decisionsOf(order.id)).toEqual([
      { kind: 'rejected', channel: 'staff', paper: true, actor: ctx.project_manager!.userId, day: TODAY },
    ]);
    const readsAsClientRefusal = async () => {
      const [row] = await listVariations(ctx.owner!, { contractId: contract.contractId });
      expect(variationStatusKey(row)).toBe('rejected');
      const page = (await getVariationByToken(rawToken))!;
      expect(page.rejectionChannel).toBe('client');
      expect(variationDecidedKey({ status: page.status, contractActive: page.contractActive, outcome: null, rejectionChannel: page.rejectionChannel })).toBe(
        'rejected',
      );
    };
    await readsAsClientRefusal();
    // Still the client's refusal once the contract is terminated after it: the
    // cascade finds the order decided and writes nothing for it.
    expect((await terminateContractCore(ctx.owner!, { id: contract.contractId })).ok).toBe(true);
    expect(await decisionsOf(order.id)).toHaveLength(1);
    await readsAsClientRefusal();
  });

  it('is open to owner, admin and project manager only', async () => {
    for (const role of ['admin', 'project_manager'] as const) {
      const { order } = await issuedOrder();
      expect(
        await recordVariationDecisionOnPaperCore(ctx[role]!, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY }),
        role,
      ).toMatchObject({ ok: true });
    }
    for (const role of ['site_engineer', 'accountant', 'viewer'] as const) {
      const { order } = await issuedOrder();
      expect(
        await recordVariationDecisionOnPaperCore(ctx[role]!, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY }),
        role,
      ).toEqual({ ok: false, error: 'forbidden' });
      expect(await statusOf(order.id)).toBe('issued');
    }
  });

  it('refuses an order that is not issued (variation_not_issued) and writes nothing', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    for (const status of ['draft', 'internal_approved', 'approved', 'rejected'] as const) {
      const order = await seedVariation(orgId, contract, status);
      expect(
        await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY }),
        status,
      ).toEqual({ ok: false, error: 'variation_not_issued' });
      expect(await statusOf(order.id)).toBe(status);
      expect(await decisionsOf(order.id)).toEqual([]);
    }
  });

  it.each(['approve', 'reject'] as const)(
    'refuses an answer (%s) on an issued order whose contract is no longer live, in its own words (variation_contract_ended, never the billing refusal)',
    async (decision) => {
      const { contract, order } = await issuedOrder();
      // No app path leaves an issued order under a terminated contract (the
      // termination rejects it in the same transaction): only a tamper can.
      await tamper(`update public.contracts set status = 'terminated' where id = $1`, [contract.contractId]);
      expect(
        await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: order.id, decision, decidedOn: TODAY }),
      ).toEqual({ ok: false, error: 'variation_contract_ended' });
      expect(await statusOf(order.id)).toBe('issued');
      expect(await decisionsOf(order.id)).toEqual([]);
    },
  );

  it('takes an order of a proposal contract, as the client can online', async () => {
    const contractId = await seedProposalContract(orgId);
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [contractId]);
    const [project] = await ownerQuery<{ project_id: string }>(`select project_id from public.contracts where id = $1`, [contractId]);
    const order = await seedVariation(orgId, { contractId, projectId: project.project_id }, 'issued');
    expect(
      await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY }),
    ).toMatchObject({ ok: true });
    expect(await statusOf(order.id)).toBe('approved');
  });

  it('says a missing answer, a missing, future or impossible day and an over-long note under their boxes', async () => {
    const { order } = await issuedOrder();
    const id = order.id;
    expect(await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: id, decidedOn: '' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { decision: { code: 'required' }, decidedOn: { code: 'required' } },
    });
    expect(
      await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: id, decision: 'maybe', decidedOn: '2026-02-30' }),
    ).toMatchObject({ fields: { decision: { code: 'required' }, decidedOn: { code: 'invalid_date' } } });
    expect(
      await recordVariationDecisionOnPaperCore(ctx.owner!, {
        variationOrderId: id,
        decision: 'reject',
        decidedOn: '2999-01-01',
        note: 'x'.repeat(501),
      }),
    ).toMatchObject({ fields: { decidedOn: { code: 'date_in_future' }, note: { code: 'too_long', params: { max: 500 } } } });
    expect(await statusOf(id)).toBe('issued');
  });

  it('refuses a note holding a lone surrogate half under its box, never as a failed write (F8)', async () => {
    const { order } = await issuedOrder();
    expect(
      await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY, note: 'x\ud800y' }),
    ).toEqual({ ok: false, error: 'check_fields', fields: { note: { code: 'unprintable' } } });
    expect(await statusOf(order.id)).toBe('issued');
    expect(await decisionsOf(order.id)).toEqual([]);
  });

  it('refuses a day before the order\'s Cairo issue day under its box, naming the change order (F2), and takes the issue day itself', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const order = await seedVariation(orgId, contract, 'issued');
    // 00:30 in Cairo on Oct 5 is still Oct 4 in UTC: the Cairo day decides.
    await issuedAt(order.id, '2026-10-05 00:30+03');
    expect(
      await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: order.id, decision: 'approve', decidedOn: '2026-10-04' }),
    ).toEqual({ ok: false, error: 'check_fields', fields: { decidedOn: { code: 'date_before_variation_issue', params: { date: '05/10/2026' } } } });
    expect(await statusOf(order.id)).toBe('issued');
    expect(
      await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: order.id, decision: 'approve', decidedOn: '2026-10-05' }),
    ).toMatchObject({ ok: true });
    expect((await decisionsOf(order.id))[0].day).toBe('2026-10-05');
  });

  it('answers malformed for a bad payload or id, and record_not_found for an order of another studio', async () => {
    const call = recordVariationDecisionOnPaperCore as (c: OrgContext, input: unknown) => ReturnType<typeof recordVariationDecisionOnPaperCore>;
    for (const payload of [null, undefined, 'x', 7, { variationOrderId: 'not-a-uuid', decision: 'approve', decidedOn: TODAY }]) {
      expect(await call(ctx.owner!, payload), JSON.stringify(payload)).toEqual({ ok: false, error: 'malformed' });
    }
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const foreign = await seedExecutionContract(other.orgId, { state: 'signed' });
    const order = await seedVariation(other.orgId, foreign, 'issued');
    expect(
      await recordVariationDecisionOnPaperCore(ctx.owner!, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY }),
    ).toEqual({ ok: false, error: 'record_not_found' });
    expect(await statusOf(order.id)).toBe('issued');
  });
});
