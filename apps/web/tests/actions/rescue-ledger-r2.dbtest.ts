import { afterAll, describe, expect, it } from 'vitest';
import { loadRescueLedgerCore } from '@/lib/dashboard/rescue-ledger/core';
import { closeFixture, raw, teardown } from './fixture';
import { DAY_MS, delivery, followupAlert, HOUR_MS, monthOf, reminder, rescueOrg, transition, type RescueOrg } from './rescue-ledger-fixture';

// R2, stages moved after a follow up, against a real database: alert (the
// cron's weekly row), action (a reminder strictly between), outcome (the first
// advancing transition after the alert).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const t0 = new Date(Date.now() - 30 * DAY_MS);
const at = (days: number, hours = 0) => new Date(t0.getTime() + days * DAY_MS + hours * HOUR_MS);

async function stagesMoved(org: RescueOrg) {
  const result = await loadRescueLedgerCore(org.contexts.owner, { range: 6 });
  if (!result.ok) throw new Error(`ledger refused: ${result.error}`);
  return result.data;
}

/** A delivery waiting at concept_review since day 0, alerted at day 1. */
async function waitingAtConcept(org: RescueOrg, number: number): Promise<string> {
  const id = await delivery(org, number);
  await transition(org, id, 'optionsReady', 'layout', 'concept_review', at(0));
  await followupAlert(org, id, at(1));
  return id;
}

const advance = (org: RescueOrg, id: string, days: number) =>
  transition(org, id, 'selectConcept', 'concept_review', 'negotiation', at(days));

describe('R2: a follow up, a reminder, then the stage moved', () => {
  it('counts one stage moved, in the month of the advance (AC9)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await waitingAtConcept(org, 1);
    await reminder(org, id, 'email', at(1, 1));
    await advance(org, id, 3);
    const ledger = await stagesMoved(org);
    expect(ledger.stagesMoved).toEqual({ count: 1, deliveries: 1, followups: 1 });
    const month = await monthOf(at(3));
    expect(ledger.months.find((m) => m.month === month)?.stagesMoved).toBe(1);
  });

  it('counts a prepared WhatsApp reminder (D3)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await waitingAtConcept(org, 1);
    await reminder(org, id, 'prepared', at(1, 1));
    await advance(org, id, 3);
    expect((await stagesMoved(org)).stagesMoved.count).toBe(1);
  });

  it('counts 0 with no reminder, a reminder before the alert only, or an email that failed (AC10)', async () => {
    const org = await rescueOrg(orgIds);
    const silent = await waitingAtConcept(org, 1);
    await advance(org, silent, 3);
    const early = await waitingAtConcept(org, 2);
    await reminder(org, early, 'email', at(0, 12));
    await advance(org, early, 3);
    const failed = await waitingAtConcept(org, 3);
    await reminder(org, failed, 'email', at(1, 1));
    await reminder(org, failed, 'email_failed', new Date(at(1, 1).getTime() + 60_000));
    await advance(org, failed, 3);
    expect((await stagesMoved(org)).stagesMoved).toEqual({ count: 0, deliveries: 0, followups: 0 });
  });

  it('the chain ends at the FIRST advance: a reminder after it does not count', async () => {
    const org = await rescueOrg(orgIds);
    const id = await waitingAtConcept(org, 1);
    await advance(org, id, 3);
    await reminder(org, id, 'prepared', at(4));
    await transition(org, id, 'confirmConcept', 'negotiation', 'design_3d', at(5));
    expect((await stagesMoved(org)).stagesMoved.count).toBe(0);
  });

  it('counts an email whose failure came after the cooldown', async () => {
    const org = await rescueOrg(orgIds);
    const id = await waitingAtConcept(org, 1);
    await reminder(org, id, 'email', at(1, 1));
    await reminder(org, id, 'email_failed', at(1, 2));
    await advance(org, id, 3);
    expect((await stagesMoved(org)).stagesMoved.count).toBe(1);
  });

  it('three weekly alerts and one advance count once, with three follow ups (AC11)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await waitingAtConcept(org, 1);
    await reminder(org, id, 'email', at(1, 1));
    for (const week of [8, 15]) {
      await followupAlert(org, id, at(week));
      await reminder(org, id, 'prepared', at(week, 1));
    }
    await advance(org, id, 17);
    expect((await stagesMoved(org)).stagesMoved).toEqual({ count: 1, deliveries: 1, followups: 3 });
  });

  it('a self loop does not end the chain; an abandon is not a rescue (AC11)', async () => {
    const org = await rescueOrg(orgIds);
    const looped = await delivery(org, 1);
    await transition(org, looped, 'confirmConcept', 'concept_review', 'negotiation', at(0));
    await followupAlert(org, looped, at(1));
    await transition(org, looped, 'requestRevision', 'negotiation', 'negotiation', at(2));
    await reminder(org, looped, 'prepared', at(2, 1));
    await transition(org, looped, 'confirmConcept', 'negotiation', 'design_3d', at(3));
    const dropped = await waitingAtConcept(org, 2);
    await reminder(org, dropped, 'prepared', at(1, 1));
    await transition(org, dropped, 'abandon', 'concept_review', 'abandoned', at(3));
    expect((await stagesMoved(org)).stagesMoved).toEqual({ count: 1, deliveries: 1, followups: 1 });
  });

  it('counts 0 for a wait that leaves final approval: that wait belongs to R5 (AC12)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await transition(org, id, 'rendersReady', 'design_3d', 'final_approval', at(0));
    await followupAlert(org, id, at(1));
    await reminder(org, id, 'prepared', at(1, 1));
    await transition(org, id, 'approveDesign', 'final_approval', 'shop_drawings', at(3));
    expect((await stagesMoved(org)).stagesMoved.count).toBe(0);
  });

  it('ignores an alert whose key names no delivery, without failing the read', async () => {
    const org = await rescueOrg(orgIds);
    const id = await waitingAtConcept(org, 1);
    await reminder(org, id, 'prepared', at(1, 1));
    await advance(org, id, 3);
    await raw.query(`insert into public.automation_run_log (org_id, automation_key, period_key, created_at)
      values ('${org.orgId}', 'delivery-followup', 'not-a-uuid:2026-W40', '${at(1).toISOString()}')`);
    expect((await stagesMoved(org)).stagesMoved.count).toBe(1);
  });
});
