import { afterAll, describe, expect, it } from 'vitest';
import { addDays, todayInCairo } from '@/lib/automation/clock';
import { setClientExpectedDateCore } from '@/lib/engagements/client-expected';
import { closeFixture, ctxFor, raw, teardown } from './fixture';
import {
  ageUpdatedAt,
  forceState,
  seedRoundBDelivery,
  snapshotOf,
  updatedAtRefreshed,
  type RoundBDelivery,
} from './round-b-fixture';
import { plantTransition } from './round-c-db-fixture';

// Round C, C8 (AC 44): the studio sets the date the client page promises for
// the next step. All three 0058 columns are written together, the stage is
// the row's own, `updated_at` never moves, and the client page shows the date
// only until the delivery moves on.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const today = todayInCairo(new Date());

async function columns(engagementId: string) {
  const [row] = await raw.query<{ on: string | null; state: string | null; set_at: string | null }>(
    `select client_expected_on::text as on, client_expected_state::text as state,
            client_expected_set_at::text as set_at
       from public.design_engagements where id = '${engagementId}'`,
  );
  return row;
}

async function atConceptReview(suffix: string): Promise<RoundBDelivery & { pm: string }> {
  const d = await seedRoundBDelivery(orgIds, suffix, [{ role: 'project_manager' }, { role: 'accountant' }]);
  await forceState(d.engagementId, 'concept_review');
  return { ...d, pm: d.memberIds[0] };
}

describe('setClientExpectedDateCore', () => {
  it('a PM sets a date at concept_review: the client sees it and updated_at stays put', async () => {
    const d = await atConceptReview('expected-set');
    const pm = ctxFor(d.orgId, d.pm, 'project_manager');
    const day = addDays(today, 3);
    await ageUpdatedAt(d.engagementId);
    expect(await setClientExpectedDateCore(pm, { engagementId: d.engagementId, expectedOn: day })).toEqual({
      ok: true,
      data: undefined,
    });
    expect((await snapshotOf(d.hash))!.expected_on).toBe(day);
    expect(await columns(d.engagementId)).toMatchObject({ on: day, state: 'concept_review' });
    expect((await columns(d.engagementId)).set_at).not.toBeNull();
    expect(await updatedAtRefreshed(d.engagementId)).toBe(false);
  });

  it('after the delivery advances the client no longer sees it', async () => {
    const d = await atConceptReview('expected-advance');
    const day = addDays(today, 2);
    expect((await setClientExpectedDateCore(d.ctx, { engagementId: d.engagementId, expectedOn: day })).ok).toBe(true);
    await plantTransition(d, 'concept_review', 'design_3d', 'clock_timestamp()');
    await forceState(d.engagementId, 'design_3d');
    expect((await snapshotOf(d.hash))!.expected_on).toBeNull();
  });

  it('clears all three columns together', async () => {
    const d = await atConceptReview('expected-clear');
    await setClientExpectedDateCore(d.ctx, { engagementId: d.engagementId, expectedOn: addDays(today, 5) });
    expect((await setClientExpectedDateCore(d.ctx, { engagementId: d.engagementId, expectedOn: null })).ok).toBe(true);
    expect(await columns(d.engagementId)).toEqual({ on: null, state: null, set_at: null });
    expect((await snapshotOf(d.hash))!.expected_on).toBeNull();
  });

  it('refuses yesterday, a day past a year ahead, an impossible day and a non-date', async () => {
    const d = await atConceptReview('expected-bad');
    for (const expectedOn of [addDays(today, -1), addDays(today, 366), '2026-02-30', '20261020', 42 as never]) {
      const result = await setClientExpectedDateCore(d.ctx, { engagementId: d.engagementId, expectedOn });
      expect(result, String(expectedOn)).toEqual({ ok: false, error: 'invalid_date' });
    }
    expect((await setClientExpectedDateCore(d.ctx, { engagementId: d.engagementId, expectedOn: today })).ok).toBe(true);
    expect(
      (await setClientExpectedDateCore(d.ctx, { engagementId: d.engagementId, expectedOn: addDays(today, 365) })).ok,
    ).toBe(true);
  });

  it('refuses a finished delivery, a foreign one, a bad id and a role without design update', async () => {
    const d = await atConceptReview('expected-refusals');
    const other = await atConceptReview('expected-other');
    const day = addDays(today, 1);
    await forceState(d.engagementId, 'closed_design_only');
    expect(await setClientExpectedDateCore(d.ctx, { engagementId: d.engagementId, expectedOn: day })).toEqual({
      ok: false,
      error: 'engagement_not_active',
    });
    expect(await setClientExpectedDateCore(d.ctx, { engagementId: other.engagementId, expectedOn: day })).toEqual({
      ok: false,
      error: 'engagement_not_found',
    });
    expect(await setClientExpectedDateCore(d.ctx, { engagementId: 'nope', expectedOn: day })).toEqual({
      ok: false,
      error: 'invalid',
    });
    const accountant = ctxFor(other.orgId, other.memberIds[1], 'accountant');
    expect(await setClientExpectedDateCore(accountant, { engagementId: other.engagementId, expectedOn: day })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await columns(other.engagementId)).toEqual({ on: null, state: null, set_at: null });
  });
});
