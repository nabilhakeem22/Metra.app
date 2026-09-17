import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

/**
 * TWO CONCURRENT ATTEMPTS UNDER ONE IDEMPOTENCY KEY — the path wave 4 physically
 * moved, and the one nothing drove.
 *
 * The suite covered the key SEQUENTIALLY (`engagements-revision.dbtest.ts`: same
 * key twice, two different keys, no key, a malformed key, trigger-scoped) and
 * covered CONCURRENCY WITHOUT a key, and covered two concurrent ADVANCING edges
 * (`engagements-executor.dbtest.ts`). Nothing put `Promise.all` and one key in
 * the same sentence — which is precisely `executor/self-loop.ts` (lockSelfLoop
 * BEFORE hasCommittedAttempt) and `executor/ledger.ts` (REPLAY_ARBITER,
 * failLostIdempotencyRace). A silent reordering of those two phases would have
 * failed no test, and `failLostIdempotencyRace` is unreachable exactly while the
 * ordering is right, so its own existence proves nothing.
 *
 * It is also the only way a studio produces this in the wild: a double tap on a
 * slow connection.
 *
 * This file ADDS a file rather than editing one: AC7 pins zero edits to the
 * `engagements-*.dbtest.ts` suites, and the property is worth more than the
 * tidiness of putting these cases next to their siblings.
 */

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// A 4-milestone AMOUNT split: deposit 30,000, gate_a 20,000 (fee 100,000).
const AMOUNT_SPLIT: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

async function scalar(sql: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(sql);
  return Number(row.n);
}

const revisionCountOf = (engagementId: string) =>
  scalar(
    `select revision_count::int as n from public.design_engagements
      where id = '${engagementId}'`,
  );

const transitionCountOf = (engagementId: string, trigger: string) =>
  scalar(
    `select count(*)::int as n from public.engagement_transitions
      where engagement_id = '${engagementId}' and trigger = '${trigger}'`,
  );

const changeOrderCountOf = (engagementId: string) =>
  scalar(
    `select count(*)::int as n from public.engagement_change_orders
      where engagement_id = '${engagementId}'`,
  );

/**
 * Seed an org + client + project and drive ONE engagement to `negotiation`,
 * where `requestRevision` is a self-loop. Same ladder as
 * `engagements-revision.dbtest.ts`'s setup, deliberately: the two files must be
 * describing the same engagement for their results to be comparable.
 */
async function setupNegotiation(): Promise<{ ctx: OrgContext; engagementId: string }> {
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
    offPlan: false,
  });
  const engagementId = (created as { data?: string }).data!;
  expect(
    (
      await executeTransition(ctx, {
        engagementId,
        trigger: 'submitDesignFee',
        payload: AMOUNT_SPLIT,
      })
    ).ok,
  ).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' })).ok,
  ).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  expect((await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' })).ok).toBe(
    true,
  );
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  expect((await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  expect((await executeTransition(ctx, { engagementId, trigger: 'selectConcept' })).ok).toBe(true);
  return { ctx, engagementId };
}

const KEY = '99999999-9999-4999-8999-999999999999';
const OTHER_KEY = '88888888-8888-4888-8888-888888888888';

describe('the DOUBLE TAP: two concurrent self-loops carrying ONE idempotency key', () => {
  it('spends one revision, writes one ledger row, and tells NEITHER caller it failed', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    const [first, second] = await Promise.all([
      executeTransition(ctx, { engagementId, trigger: 'requestRevision', idempotencyKey: KEY }),
      executeTransition(ctx, { engagementId, trigger: 'requestRevision', idempotencyKey: KEY }),
    ]);

    // THE SAFETY INVARIANT — one act.
    expect(await revisionCountOf(engagementId)).toBe(1);
    expect(await transitionCountOf(engagementId, 'requestRevision')).toBe(1);

    // THE LIVENESS INVARIANT, and the one that can regress silently. Because
    // `lockSelfLoop` runs BEFORE `hasCommittedAttempt`, the second caller waits
    // for the first to COMMIT and then sees its ledger row, so it returns plain
    // `ok` — the act it asked for happened. `failLostIdempotencyRace` (the ON
    // CONFLICT loser) is the backstop for an interleaving the row lock is meant
    // to make impossible; if this ever sees `engagement_state_conflict`, the
    // lock has stopped preceding the read and the PHASE ORDER in
    // `executor/index.ts runTransition` is what to look at first.
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('ten taps on one key are still one revision', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        executeTransition(ctx, {
          engagementId,
          trigger: 'requestRevision',
          idempotencyKey: KEY,
        }),
      ),
    );
    expect(await revisionCountOf(engagementId)).toBe(1);
    expect(await transitionCountOf(engagementId, 'requestRevision')).toBe(1);
    // Ten callers serialise on ONE row lock under a 5s lock_timeout. A waiter
    // that times out is a RECORDED ambiguous outcome — never a refusal, never a
    // second increment. If this starts failing on the runner, the per-transition
    // cost has grown past ~500ms; that is the finding, not the flake.
    for (const result of results) {
      if (!result.ok) expect(result.error).toBe('uncertain');
    }
  });

  it('a key whose attempt FAILED its guard does not block the corrected retry', async () => {
    // The crossing revision with no amount rolls the whole transaction back, so
    // NO ledger row carries the key. A retry under the SAME key must be admitted
    // and must actually apply: a pre-check answering from anything but a
    // COMMITTED row would turn a failed attempt into a permanent `ok` that wrote
    // nothing.
    const { ctx, engagementId } = await setupNegotiation();
    for (let i = 0; i < 3; i++) {
      expect((await executeTransition(ctx, { engagementId, trigger: 'requestRevision' })).ok).toBe(
        true,
      );
    }
    const refused = await executeTransition(ctx, {
      engagementId,
      trigger: 'requestRevision',
      idempotencyKey: KEY,
    });
    expect(refused).toEqual({ ok: false, error: 'revision_co_amount_required' });
    expect(await revisionCountOf(engagementId)).toBe(3);

    const retried = await executeTransition(ctx, {
      engagementId,
      trigger: 'requestRevision',
      idempotencyKey: KEY,
      payload: { changeOrderAmount: '5000' },
    });
    expect(retried.ok).toBe(true);
    expect(await revisionCountOf(engagementId)).toBe(4);
    expect(await changeOrderCountOf(engagementId)).toBe(1);
  });

  it('two CONCURRENT taps with DIFFERENT keys are two acts', async () => {
    // The mirror of the first case: the lock serialises them, each pre-check
    // finds nothing under ITS key, and both apply. Two rows, two increments, no
    // lost update — which is what proves the first case is idempotency doing the
    // work and not the lock swallowing one of them.
    const { ctx, engagementId } = await setupNegotiation();
    const [first, second] = await Promise.all([
      executeTransition(ctx, { engagementId, trigger: 'requestRevision', idempotencyKey: KEY }),
      executeTransition(ctx, {
        engagementId,
        trigger: 'requestRevision',
        idempotencyKey: OTHER_KEY,
      }),
    ]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(await revisionCountOf(engagementId)).toBe(2);
    expect(await transitionCountOf(engagementId, 'requestRevision')).toBe(2);
  });
});
