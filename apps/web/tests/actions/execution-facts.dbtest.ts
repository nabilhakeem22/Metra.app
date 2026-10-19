import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateExecutionContractCore,
  issueContractCore,
  recordContractSignedOfflineCore,
} from '@/lib/contracts/core';
import { saveContractScheduleCore } from '@/lib/contracts/schedule/save';
import type { OrgContext } from '@/lib/db/context';
import { getExecutionFacts } from '@/lib/execution/queries/facts';
import { executionStage } from '@/lib/execution/stage';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedRequest } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A3.5, AC10 (the data half): the delivery's execution card derives one
// stage and one next action from what the database holds, a step at a time
// from "no BOQ" to "settled", through the real cores where they exist (A3) and
// rows written by SQL where they do not yet (requests, payments: PR A4).

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

async function stageOf(engagementId: string) {
  const card = await getExecutionFacts(owner, engagementId);
  return { ...executionStage(card.facts), card };
}

const SPLIT = [
  { labelAr: null, labelEn: 'Advance', basis: 'percent', value: '50' },
  { labelAr: null, labelEn: 'Works', basis: 'percent', value: '30' },
  { labelAr: null, labelEn: 'Handover', basis: 'percent', value: '20' },
];

async function pay(contractId: string, requestId: string, amount: string): Promise<void> {
  await ownerQuery(
    `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by)
     values ($1, $2, $3, $4, current_date, $5)`,
    [orgId, contractId, requestId, amount, owner.userId],
  );
}

describe('the execution card, stage by stage', () => {
  it('walks no_boq -> no_contract -> draft -> awaiting_signature -> in_progress -> settled', async () => {
    const ids = await seedClientProject(orgId);
    const engagementId = await seedDelivery(orgId, ids, 'execution');
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'no_boq', next: { kind: 'open_boq' } });

    const boq = await seedBoq(orgId, { total: '100000', project: ids, engagementId, linesPerSection: [5] });
    const noContract = await stageOf(engagementId);
    expect(noContract).toMatchObject({ stage: 'no_contract', next: { kind: 'create_contract' } });
    expect(noContract.card.boqId).toBe(boq.boqId);

    const contractId = (await generateExecutionContractCore(owner, { boqId: boq.boqId, taxRate: '14', supervisionPct: '10' })).data!;
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'draft', next: { kind: 'set_schedule' } });
    await saveContractScheduleCore(owner, { contractId, milestones: SPLIT });
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'draft', next: { kind: 'send_contract' } });

    await issueContractCore(owner, { id: contractId });
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'awaiting_signature', next: { kind: 'record_signed_offline' } });

    await recordContractSignedOfflineCore(owner, { contractId, signedOn: '2026-10-01' });
    const signed = await stageOf(engagementId);
    expect(signed).toMatchObject({ stage: 'in_progress', next: { kind: 'send_milestone_request' } });
    const milestones = await ownerQuery<{ id: string }>(
      `select id from public.contract_payment_milestones where contract_id = $1 order by sort_order`,
      [contractId],
    );
    expect(signed.card.facts.contract?.nextUnbilledMilestone).toEqual({ id: milestones[0].id, amount: '62000.0000' });
    expect(signed.card.facts.contract).toMatchObject({ billingBalance: '124000.0000', finalAccountBalance: '124000.0000' });

    const first = await seedRequest(orgId, contractId, owner.userId, { milestoneId: milestones[0].id }, '62000');
    const billedOnce = await stageOf(engagementId);
    expect(billedOnce.card.facts.contract).toMatchObject({
      nextUnbilledMilestone: { id: milestones[1].id, amount: '37200.0000' },
      unpaidRequestCount: 1,
      billingBalance: '62000.0000',
    });

    await ownerQuery(
      `insert into public.contract_payment_claims (org_id, contract_id, request_id, claimed_amount) values ($1, $2, $3, 62000)`,
      [orgId, contractId, first],
    );
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'in_progress', next: { kind: 'review_payment_claim' } });
    await ownerQuery(`update public.contract_payment_claims set status = 'dismissed', resolved_by = $2, resolved_at = now() where request_id = $1`, [
      first,
      owner.userId,
    ]);

    await pay(contractId, first, '62000');
    for (const [index, amount] of [[1, '37200'], [2, '24800']] as const) {
      await pay(contractId, await seedRequest(orgId, contractId, owner.userId, { milestoneId: milestones[index].id }, amount), amount);
    }
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'settled', next: null });

    // A provisional line measured past its quantity: the end state reads the full balance.
    const [line] = await ownerQuery<{ id: string; qty: string }>(
      `select id, qty::text from public.contract_lines where contract_id = $1 and provisional order by sort_order limit 1`,
      [contractId],
    );
    await ownerQuery(
      `insert into public.contract_line_measurements (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
       values ($1, $2, $3, $4::numeric + 10, current_date, $5)`,
      [orgId, contractId, line.id, line.qty, owner.userId],
    );
    const measured = await stageOf(engagementId);
    // 10 more units at 100: 1,000 works + 14% VAT + 10% supervision = 1,240.
    expect(measured.card.facts.contract).toMatchObject({ billingBalance: '0.0000', finalAccountBalance: '1240.0000' });
    expect(measured).toMatchObject({ stage: 'in_progress', next: { kind: 'prepare_final_account' } });

    const finalRequest = await seedRequest(orgId, contractId, owner.userId, {}, '1240');
    const finalIssued = await stageOf(engagementId);
    expect(finalIssued).toMatchObject({ stage: 'final_account', next: { kind: 'record_payment' } });
    expect(finalIssued.card.facts.contract).toMatchObject({ finalAccountOutstanding: '1240.0000', finalAccountBalance: '0.0000' });
    await pay(contractId, finalRequest, '1240');
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'settled', next: null });

    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [contractId]);
    expect(await stageOf(engagementId)).toMatchObject({ stage: 'terminated', next: null });
  });

  it('shows the live contract before a newer terminated one, and nothing of another delivery', async () => {
    const ids = await seedClientProject(orgId);
    const engagementId = await seedDelivery(orgId, ids, 'execution');
    const live = await seedBoq(orgId, { project: ids, engagementId });
    const old = await seedBoq(orgId, { project: ids, engagementId, state: 'superseded' });
    const liveId = (await generateExecutionContractCore(owner, { boqId: live.boqId, taxRate: '14', supervisionPct: '0' })).data!;
    // A newer contract, terminated, on the superseded BOQ (written by SQL: no core makes one).
    await ownerQuery(
      `insert into public.contracts (org_id, number, title_en, source_boq_id, client_id, project_id, status, created_at)
       values ($1, 999, 'Old', $2, $3, $4, 'draft', now() + interval '1 hour')`,
      [orgId, old.boqId, ids.clientId, ids.projectId],
    );
    await ownerQuery(`update public.contracts set status = 'terminated' where number = 999 and org_id = $1`, [orgId]);
    expect((await stageOf(engagementId)).card.contract?.id).toBe(liveId);

    const elsewhere = await seedDelivery(orgId, ids, 'execution');
    expect(await stageOf(elsewhere)).toMatchObject({ stage: 'no_boq', card: { contract: null, boqId: null } });
  });
});
