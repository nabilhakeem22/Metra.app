import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import { generateExecutionContractCore, issueContractCore, recordContractSignedOfflineCore } from '@/lib/contracts/core';
import { saveContractScheduleCore } from '@/lib/contracts/schedule/save';
import type { OrgContext } from '@/lib/db/context';
import { executionDeliveryStatus } from '@/lib/engagements/delivery-status';
import { recordContractPaymentCore } from '@/lib/execution/payments/core';
import { getExecutionFacts } from '@/lib/execution/queries/facts';
import { issueMilestoneRequestCore } from '@/lib/execution/requests/issue-milestone';
import { executionStage } from '@/lib/execution/stage';
import { locateExecutionForClient } from '@/lib/flow/locate/execution-client';
import { locateExecutionForStudio } from '@/lib/flow/locate/execution-studio';
import { createVariationDraftCore, saveVariationDraftCore } from '@/lib/variations/core';
import { internalApproveVariationCore, issueVariationCore } from '@/lib/variations/lifecycle';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { appQuery, closeExecutionFixture, ownerQuery, seedClientProject, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Client home H2 fix round, F1 (the functional tester's repro, steps 19 to 21
// and 25, kept): a change order issued to the client whose link has expired
// can no longer be answered online (app_variation_respond_by_token answers
// `expired`), so the cockpit must not say it waits on the client. It is the
// studio's move, as the closed signing window is (F4). Real cores throughout;
// only the clock is moved by SQL, the way the facts dbtest moves the contract's.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const SPLIT = [
  { labelAr: null, labelEn: 'Advance', basis: 'percent', value: '50' },
  { labelAr: null, labelEn: 'Works', basis: 'percent', value: '30' },
  { labelAr: null, labelEn: 'Handover', basis: 'percent', value: '20' },
];

function ok<T extends { ok: boolean }>(result: T, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result)}`);
  return result;
}

/** What the cockpit and the client home read at this moment, side by side. */
async function reading(engagementId: string) {
  const { flow } = await getExecutionFacts(owner, engagementId);
  const studio = locateExecutionForStudio(flow);
  return {
    flow,
    next: executionStage(flow.stage).next?.kind ?? null,
    studio,
    client: locateExecutionForClient(flow),
    header: executionDeliveryStatus(studio).kind,
  };
}

/** The client's online answer to a change order, as the token route gives it. */
async function clientAnswers(variationOrderId: string, decision: 'approve' | 'reject'): Promise<string> {
  const [{ token_hash: hash }] = await ownerQuery<{ token_hash: string }>(
    'select token_hash from public.variation_orders where id = $1',
    [variationOrderId],
  );
  const [row] = await appQuery<{ answer: string }>(
    orgId,
    owner.userId,
    "select public.app_variation_respond_by_token($1, $2, 'Client', '127.0.0.1', 'dbtest') as answer",
    [hash, decision],
  );
  return row.answer;
}

/** A change order with one line, approved inside the studio. */
async function internallyApprovedChangeOrder(contractId: string): Promise<string> {
  // The core returns the new id beside its typed result (concurrency-gates.dbtest reads it the same way).
  const id = (ok(await createVariationDraftCore(owner, { contractId, titleEn: 'Extra niche' }), 'draft') as { data?: string }).data!;
  ok(
    await saveVariationDraftCore(owner, {
      id,
      lines: [{ descriptionEn: 'Niche', qty: '1', unit: 'pcs', unitCost: '100', unitPrice: '200', discountPct: '0' }],
    }),
    'lines',
  );
  ok(await internalApproveVariationCore(owner, { id }), 'internal approval');
  return id;
}

const expireLink = (variationOrderId: string) =>
  tamper(`update public.variation_orders set share_expires_at = now() - interval '1 minute' where id = $1`, [variationOrderId]);

/** A signed contract on a delivery at execution, every instalment billed and paid, so a change order is the next action. */
async function paidUpDelivery(): Promise<{ engagementId: string; contractId: string }> {
  const ids = await seedClientProject(orgId);
  const engagementId = await seedDelivery(orgId, ids, 'execution');
  const boq = await seedBoq(orgId, { total: '100000', project: ids, engagementId, linesPerSection: [5] });
  const contractId = ok(await generateExecutionContractCore(owner, { boqId: boq.boqId, taxRate: '14', supervisionPct: '10' }), 'generate').data!;
  ok(await saveContractScheduleCore(owner, { contractId, milestones: SPLIT }), 'schedule');
  ok(await issueContractCore(owner, { id: contractId }), 'issue contract');
  ok(await recordContractSignedOfflineCore(owner, { contractId, signedOn: todayInCairo(new Date()) }), 'sign');
  const milestones = await ownerQuery<{ id: string }>(
    'select id from public.contract_payment_milestones where contract_id = $1 order by sort_order',
    [contractId],
  );
  for (const milestone of milestones) {
    const requestId = ok(await issueMilestoneRequestCore(owner, { milestoneId: milestone.id }), 'request').data!;
    const [{ amount }] = await ownerQuery<{ amount: string }>('select amount::text from public.payment_requests where id = $1', [requestId]);
    ok(
      await recordContractPaymentCore(owner, { requestId, amount, receivedOn: todayInCairo(new Date()), idempotencyKey: randomUUID() }),
      'payment',
    );
  }
  return { engagementId, contractId };
}

describe('a change order whose client link has expired is the studio move (F1)', () => {
  it('approved internally, issued, then expired: studio, client, then studio again; the client can no longer answer it', async () => {
    const { engagementId, contractId } = await paidUpDelivery();
    expect((await reading(engagementId)).next).toBeNull();

    const changeOrder = await internallyApprovedChangeOrder(contractId);
    const internal = await reading(engagementId);
    expect(internal).toMatchObject({
      next: 'await_variation_answer',
      studio: { step: 'works', whoseMove: 'studio', takenBack: 'change_order_not_issued' },
      client: { reason: 'works_in_progress' },
      header: 'yourMove',
    });

    ok(await issueVariationCore(owner, { id: changeOrder }), 'issue change order');
    const issued = await reading(engagementId);
    expect(issued.flow).toMatchObject({ issuedChangeOrderCount: 1, expiredChangeOrderCount: 0 });
    expect(issued).toMatchObject({
      studio: { whoseMove: 'client', takenBack: null },
      client: { reason: 'decide_change_order', whoseMove: 'client' },
      header: 'waitingClient',
    });

    await expireLink(changeOrder);
    const expired = await reading(engagementId);
    expect(expired.flow).toMatchObject({ issuedChangeOrderCount: 0, expiredChangeOrderCount: 1, stage: { contract: { openVariationCount: 1 } } });
    expect(expired).toMatchObject({
      next: 'await_variation_answer',
      studio: { step: 'works', whoseMove: 'studio', status: 'active', takenBack: 'change_order_link_expired' },
      header: 'yourMove',
    });
    expect(expired.client.reason).not.toBe('decide_change_order');
    expect(expired.client.whoseMove).not.toBe('client');
    // The database agrees: the client's answer is refused.
    expect(await clientAnswers(changeOrder, 'approve')).toBe('expired');

    // A live link again (no app path renews one yet, AC32): back to the client, who answers.
    await tamper(`update public.variation_orders set share_expires_at = now() + interval '1 day' where id = $1`, [changeOrder]);
    expect((await reading(engagementId)).header).toBe('waitingClient');
    expect(await clientAnswers(changeOrder, 'approve')).toBe('ok');
    expect((await reading(engagementId)).flow).toMatchObject({ issuedChangeOrderCount: 0, expiredChangeOrderCount: 0 });
  });

  it('a change order issued after its link already expired reads as the studio move, not a wait on the client', async () => {
    const { engagementId, contractId } = await paidUpDelivery();
    const changeOrder = await internallyApprovedChangeOrder(contractId);
    // The link's 30 days start at internal approval today, so a change order
    // issued more than 30 days later goes out with a dead link. Issuing it is
    // still admitted: moving the window to the issue needs a database change
    // (the variation_orders immutability trigger admits only the status flip).
    await expireLink(changeOrder);
    ok(await issueVariationCore(owner, { id: changeOrder }), 'issue change order');

    const issuedDead = await reading(engagementId);
    expect(issuedDead.flow).toMatchObject({ issuedChangeOrderCount: 0, expiredChangeOrderCount: 1 });
    expect(issuedDead).toMatchObject({
      studio: { whoseMove: 'studio', takenBack: 'change_order_link_expired' },
      header: 'yourMove',
    });
    expect(issuedDead.client.reason).not.toBe('decide_change_order');
    expect(await clientAnswers(changeOrder, 'reject')).toBe('expired');
  });
});
