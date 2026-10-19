import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { DAY_MS, delivery, followupAlert, HOUR_MS, ledgerOf, monthOf, reminder, rescueOrg, transition, type RescueOrg } from './rescue-ledger-fixture';

// R2's action and its window, against a real database: the rows the reminder
// dialog really writes (F3), and the outcome month whatever the range (F2).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const t0 = new Date(Date.now() - 30 * DAY_MS);
const at = (days: number, hours = 0) => new Date(t0.getTime() + days * DAY_MS + hours * HOUR_MS);
const seconds = (from: Date, count: number) => new Date(from.getTime() + count * 1000);

/** Waiting at concept_review, alerted at `alertAt`, moved at `moveAt`. */
async function chain(org: RescueOrg, number: number, alertAt: Date, moveAt: Date): Promise<string> {
  const id = await delivery(org, number);
  await transition(org, id, 'optionsReady', 'layout', 'concept_review', new Date(alertAt.getTime() - DAY_MS));
  await followupAlert(org, id, alertAt);
  await transition(org, id, 'selectConcept', 'concept_review', 'negotiation', moveAt);
  return id;
}

describe('R2 action: the rows the reminder dialog writes (F3)', () => {
  it('prepared, then an email, then email_failed: the failed email decides, 0', async () => {
    const org = await rescueOrg(orgIds);
    const id = await chain(org, 1, at(1), at(3));
    await reminder(org, id, 'prepared', at(1, 1));
    await reminder(org, id, 'email', seconds(at(1, 1), 20));
    await reminder(org, id, 'email_failed', seconds(at(1, 1), 25));
    expect((await ledgerOf(org)).stagesMoved.count).toBe(0);
  });

  it('prepared, then an email that went out: 1', async () => {
    const org = await rescueOrg(orgIds);
    const id = await chain(org, 1, at(1), at(3));
    await reminder(org, id, 'prepared', at(1, 1));
    await reminder(org, id, 'email', seconds(at(1, 1), 20));
    expect((await ledgerOf(org)).stagesMoved.count).toBe(1);
  });

  it('prepared alone, no email within the cooldown: the WhatsApp reminder counts, 1 (D3)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await chain(org, 1, at(1), at(3));
    await reminder(org, id, 'prepared', at(1, 1));
    expect((await ledgerOf(org)).stagesMoved.count).toBe(1);
  });

  it('prepared, then a failed email 20 minutes later: the prepared text stands, 1', async () => {
    const org = await rescueOrg(orgIds);
    const id = await chain(org, 1, at(1), at(3));
    await reminder(org, id, 'prepared', at(1, 1));
    await reminder(org, id, 'email', seconds(at(1, 1), 20 * 60));
    await reminder(org, id, 'email_failed', seconds(at(1, 1), 20 * 60 + 5));
    expect((await ledgerOf(org)).stagesMoved.count).toBe(1);
  });
});

describe('R2 window: bucketed on the stage move (F2)', () => {
  it('the same month gives the same count at ranges 3, 6 and 12, with the alert and reminder before the 3 month window', async () => {
    const org = await rescueOrg(orgIds);
    const [{ start }] = await raw.query<{ start: string }>(
      `select to_json(date_trunc('month', now()) - make_interval(months => 2))#>>'{}' as start`,
    );
    const windowStart = new Date(start);
    const alertAt = new Date(windowStart.getTime() - HOUR_MS);
    const id = await chain(org, 1, alertAt, new Date(windowStart.getTime() + 2 * DAY_MS));
    await reminder(org, id, 'prepared', new Date(windowStart.getTime() - HOUR_MS / 2));
    const month = await monthOf(new Date(windowStart.getTime() + 2 * DAY_MS));
    for (const range of [3, 6, 12] as const) {
      const ledger = await ledgerOf(org, range);
      expect(ledger.stagesMoved).toEqual({ count: 1, deliveries: 1, followups: 1 });
      expect(ledger.months.find((m) => m.month === month)?.stagesMoved).toBe(1);
    }
  });

  it('an alert more than 60 days before the move is not part of its chain', async () => {
    const org = await rescueOrg(orgIds);
    const id = await chain(org, 1, at(-40), at(25));
    await reminder(org, id, 'prepared', at(-39));
    expect((await ledgerOf(org)).stagesMoved.count).toBe(0);
  });
});
