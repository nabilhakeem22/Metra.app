import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { claimPaymentByToken, recordDeliveryActionByToken } from '@/lib/engagements/public';
import { getEngagementArtifacts } from '@/lib/engagements/queries';
import { conceptOptionPositions } from '@/lib/engagements/queries/concept-positions';
import { revokeDeliveryLinkCore } from '@/lib/engagements/share';
import { closeFixture, raw, teardown } from './fixture';
import {
  attestAt,
  chooseConcept,
  forceState,
  portalLetters,
  seedArtifact,
  seedFeeSchedule,
  seedRoundBDelivery,
  setVisible,
  snapshotOf,
  stampRenders,
  type RoundBDelivery,
} from './round-b-fixture';

// Round B, PR-B12: migration 0057 and its apply-rls changes.
//   * letters rank only VISIBLE, file-bearing options, A to D, by ONE SQL rule
//     that the portal, the choose function and the studio all read (AC 3);
//   * a choice SAVES the letter the client saw and is accepted only while the
//     option still has that letter (AC 4, 5, 6);
//   * the two CHECKs and the feed index exist and bite (AC 1, 2);
//   * app_delivery_act_notified_by_token answers "was this act's notification
//     ever written?" against the act the write's `already` pointed at (AC 10).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** The client concept choices on a delivery: the option and its saved letter. */
async function choices(engagementId: string) {
  return raw.query<{ chosen_artifact_id: string; chosen_position: number }>(
    `select chosen_artifact_id, chosen_position from public.engagement_events
      where engagement_id = '${engagementId}' and kind = 'concept_approval'
        and actor_channel = 'client'`,
  );
}

/**
 * Three released, file-bearing options attested t1 < t2 < t3, a MICROSECOND
 * apart: inside one JS millisecond, so only the database can order them.
 */
async function threeOptions(delivery: RoundBDelivery): Promise<[string, string, string]> {
  await forceState(delivery.engagementId, 'concept_review');
  const t1 = await seedArtifact(delivery, 'concept_option');
  const t2 = await seedArtifact(delivery, 'concept_option');
  const t3 = await seedArtifact(delivery, 'concept_option');
  await attestAt(t1, '2026-01-01T00:00:00.000001Z');
  await attestAt(t2, '2026-01-01T00:00:00.000002Z');
  await attestAt(t3, '2026-01-01T00:00:00.000003Z');
  return [t1, t2, t3];
}

describe('one lettering rule for the portal, the choice and the studio (AC 3)', () => {
  it('ranks visible, file-bearing options only; the studio reads the same letters', async () => {
    const d = await seedRoundBDelivery(orgIds, 'letters');
    const [t1, t2, t3] = await threeOptions(d);
    await setVisible(t2, false);
    // A visible option with no file never gets a letter.
    const fileless = await seedArtifact(d, 'concept_option', { withFile: false, release: false });
    await setVisible(fileless, true);

    expect(await portalLetters(d.hash)).toEqual([
      [t1, 1],
      [t3, 2],
    ]);
    const studio = await withOrgContext(d.ctx, (tx) => conceptOptionPositions(tx, d.engagementId));
    expect([...studio.entries()]).toEqual([
      [t1, 1],
      [t3, 2],
    ]);
    const artifacts = await getEngagementArtifacts(d.ctx, d.engagementId);
    const positionOf = (id: string) => artifacts.find((artifact) => artifact.id === id)?.conceptPosition;
    expect([positionOf(t1), positionOf(t2), positionOf(t3), positionOf(fileless)]).toEqual([
      1,
      null,
      2,
      null,
    ]);
  });

  it('a fifth visible option never gets a letter', async () => {
    const d = await seedRoundBDelivery(orgIds, 'letters-fifth');
    await forceState(d.engagementId, 'concept_review');
    const options: string[] = [];
    for (let index = 0; index < 4; index += 1) options.push(await seedArtifact(d, 'concept_option'));
    const [fifth] = await raw.query<{ id: string }>(
      `insert into public.engagement_artifacts
         (org_id, engagement_id, kind, attested_by, file_id, client_visible, attested_at)
       select org_id, engagement_id, kind, attested_by, file_id, true, now() + interval '1 day'
         from public.engagement_artifacts where id = '${options[0]}'
       returning id`,
    );
    const studio = await withOrgContext(d.ctx, (tx) => conceptOptionPositions(tx, d.engagementId));
    expect(studio.has(fifth.id)).toBe(false);
    expect([...studio.values()].sort()).toEqual([1, 2, 3, 4]);
  });

  it('as metra_app, another org reads no letters for this delivery (RLS)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'letters-tenant');
    await threeOptions(d);
    const other = await seedRoundBDelivery(orgIds, 'letters-tenant-other');
    const foreign = await withOrgContext(other.ctx, (tx) => conceptOptionPositions(tx, d.engagementId));
    expect(foreign.size).toBe(0);
  });
});

describe('S1: the lettering rule reads ONE delivery through the org-leading index', () => {
  it('joins design_engagements on org and id, and stays SECURITY INVOKER', async () => {
    const [fn] = await raw.query<{ source: string; definer: boolean }>(
      `select prosrc as source, prosecdef as definer from pg_proc
        where proname = 'app_concept_option_positions'`,
    );
    expect(fn.definer).toBe(false);
    // Every engagement_artifacts index leads with org_id; the definer callers
    // carry no RLS org qual, so the org must come from the delivery row.
    expect(fn.source).toMatch(/join public\.engagement_artifacts a\s+on a\.org_id = de\.org_id and a\.engagement_id = de\.id/);
    expect(fn.source).toContain('where de.id = p_engagement_id');
  });
});

describe('a choice saves the letter the client saw (AC 4, 5, 6)', () => {
  it('saves position 2, and keeps it through every later hide and release', async () => {
    const d = await seedRoundBDelivery(orgIds, 'saved-letter');
    const [, t2, t3] = await threeOptions(d);
    await setVisible(t2, false);
    expect(await chooseConcept(d.hash, t3, 2)).toBe('ok');
    expect(await choices(d.engagementId)).toEqual([{ chosen_artifact_id: t3, chosen_position: 2 }]);
    expect((await snapshotOf(d.hash))!.concept_choice_position).toBe(2);

    // Releasing t2 again makes t3 option C for the client...
    await setVisible(t2, true);
    expect((await portalLetters(d.hash)).find(([id]) => id === t3)).toEqual([t3, 3]);
    expect((await snapshotOf(d.hash))!.concept_choice_position).toBe(2);
    // ...and hiding t3 drops it from the options; the choice still reads B.
    await setVisible(t3, false);
    const snapshot = await snapshotOf(d.hash);
    expect(snapshot!.concept_choice_id).toBe(t3);
    expect(snapshot!.concept_choice_position).toBe(2);
    expect(await choices(d.engagementId)).toEqual([{ chosen_artifact_id: t3, chosen_position: 2 }]);
  });

  it('a letter that moved under the client is wrong_state and writes nothing', async () => {
    const d = await seedRoundBDelivery(orgIds, 'stale-letter');
    const [, t2, t3] = await threeOptions(d);
    await setVisible(t2, false);
    // The client loaded the page when t3 was C; the studio hid t2 since.
    expect(await chooseConcept(d.hash, t3, 3)).toBe('wrong_state');
    for (const position of [null, 0, 5, -1]) {
      expect(await chooseConcept(d.hash, t3, position)).toBe('wrong_state');
    }
    // The hidden option, under any letter.
    for (const position of [1, 2, 3]) expect(await chooseConcept(d.hash, t2, position)).toBe('wrong_state');
    expect(await choices(d.engagementId)).toEqual([]);
    expect(await chooseConcept(d.hash, t3, 2)).toBe('ok');
    expect(await chooseConcept(d.hash, t3, 2)).toBe('already');
  });
});

describe('0057 constraints and the feed index (AC 1, 2)', () => {
  it('creates both CHECKs, and each bites with 23514', async () => {
    const [found] = await raw.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where conname in ('engagement_events_chosen_position_pairs',
                          'engagement_events_chosen_position_range')`,
    );
    expect(Number(found.n)).toBe(2);

    const d = await seedRoundBDelivery(orgIds, 'checks-0057');
    const option = await seedArtifact(d, 'concept_option');
    const insert = (columns: string, values: string) =>
      raw
        .query(
          `insert into public.engagement_events (org_id, engagement_id, kind${columns})
           values ('${d.orgId}', '${d.engagementId}', 'concept_approval'${values})`,
        )
        .catch((error: unknown) => error);
    // An option with no letter, a letter with no option, a letter past D.
    expect(sqlstateOf(await insert(', chosen_artifact_id', `, '${option}'`))).toBe('23514');
    expect(sqlstateOf(await insert(', chosen_position', ', 2'))).toBe('23514');
    expect(
      sqlstateOf(await insert(', chosen_artifact_id, chosen_position', `, '${option}', 5`)),
    ).toBe('23514');
    expect(
      sqlstateOf(await insert(', chosen_artifact_id, chosen_position', `, '${option}', 0`)),
    ).toBe('23514');
  });

  it('builds a valid notifications_org_recipient_created_idx in the feed order', async () => {
    const rows = await raw.query<{ valid: boolean; definition: string }>(
      `select i.indisvalid as valid, pg_get_indexdef(i.indexrelid) as definition
         from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname = 'notifications_org_recipient_created_idx'`,
    );
    expect(rows).toEqual([
      {
        valid: true,
        definition:
          'CREATE INDEX notifications_org_recipient_created_idx ON public.notifications USING btree (org_id, recipient_user_id, created_at DESC)',
      },
    ]);
  });
});

/** The predicate, exactly as already-notified.ts calls it. */
async function notifiedFor(
  hash: string,
  bodyKey: string,
  milestoneKind: string | null = null,
): Promise<boolean | null> {
  const milestone = milestoneKind === null ? 'null' : `'${milestoneKind}'`;
  const [row] = await raw.query<{ data: boolean | null }>(
    `select public.app_delivery_act_notified_by_token('${hash}', '${bodyKey}', ${milestone}) as data`,
  );
  return row.data;
}

async function notifyOwner(hash: string, bodyKey: string, params = '{}'): Promise<void> {
  await raw.query(
    `select public.app_delivery_notify_studio_by_token(
       '${hash}', '${bodyKey}', '${params}'::jsonb, '["owner"]'::jsonb)`,
  );
}

describe('app_delivery_act_notified_by_token (AC 10)', () => {
  it('a design approval: false until notified, then true, read or not; null in a new round', async () => {
    const d = await seedRoundBDelivery(orgIds, 'predicate-design');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '1 hour'`);
    expect(await notifiedFor(d.hash, 'client_design_approved')).toBeNull();
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({ ok: true });
    expect(await notifiedFor(d.hash, 'client_design_approved')).toBe(false);

    await notifyOwner(d.hash, 'client_design_approved');
    expect(await notifiedFor(d.hash, 'client_design_approved')).toBe(true);
    await raw.query(`update public.notifications set read_at = now() where org_id = '${d.orgId}'`);
    expect(await notifiedFor(d.hash, 'client_design_approved')).toBe(true);
    // A different act of the pair has no anchor in this round.
    expect(await notifiedFor(d.hash, 'client_design_changes_requested')).toBeNull();

    // The studio issues the renders again: no decision answers the new round.
    await stampRenders(d.engagementId, 'now()');
    expect(await notifiedFor(d.hash, 'client_design_approved')).toBeNull();
  });

  it('a concept choice is not an approval with no option, and vice versa', async () => {
    const d = await seedRoundBDelivery(orgIds, 'predicate-concept');
    await forceState(d.engagementId, 'concept_review');
    const option = await seedArtifact(d, 'concept_option');
    expect(await chooseConcept(d.hash, option, 1)).toBe('ok');
    expect(await notifiedFor(d.hash, 'client_concept_approved')).toBeNull();
    expect(await notifiedFor(d.hash, 'client_concept_chosen')).toBe(false);
    await notifyOwner(d.hash, 'client_concept_chosen');
    expect(await notifiedFor(d.hash, 'client_concept_chosen')).toBe(true);
  });

  it('a notification written BEFORE the act does not count', async () => {
    const d = await seedRoundBDelivery(orgIds, 'predicate-before');
    await forceState(d.engagementId, 'design_only_handoff');
    await notifyOwner(d.hash, 'client_handover_acknowledged');
    await raw.query(
      `update public.notifications set created_at = now() - interval '1 day' where org_id = '${d.orgId}'`,
    );
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'acknowledge_handoff' }),
    ).toEqual({ ok: true });
    expect(await notifiedFor(d.hash, 'client_handover_acknowledged')).toBe(false);
  });

  it('a payment claim answers per milestone', async () => {
    const d = await seedRoundBDelivery(orgIds, 'predicate-claim');
    await seedFeeSchedule(d);
    expect(await claimPaymentByToken(d.token, { milestoneKind: 'deposit' })).toEqual({ ok: true });
    expect(await notifiedFor(d.hash, 'client_payment_claimed', 'deposit')).toBe(false);
    expect(await notifiedFor(d.hash, 'client_payment_claimed', 'gate_a')).toBeNull();
    expect(await notifiedFor(d.hash, 'client_payment_claimed', null)).toBeNull();

    // A notification for ANOTHER milestone is not this claim's.
    await notifyOwner(d.hash, 'client_payment_claimed', '{"milestoneKind":"gate_a"}');
    expect(await notifiedFor(d.hash, 'client_payment_claimed', 'deposit')).toBe(false);
    await notifyOwner(d.hash, 'client_payment_claimed', '{"milestoneKind":"deposit"}');
    expect(await notifiedFor(d.hash, 'client_payment_claimed', 'deposit')).toBe(true);
  });

  it('answers null for a comment, an unknown key, and an expired or revoked link', async () => {
    const d = await seedRoundBDelivery(orgIds, 'predicate-null');
    await forceState(d.engagementId, 'design_only_handoff');
    expect(await recordDeliveryActionByToken(d.token, { action: 'acknowledge_handoff' })).toEqual({
      ok: true,
    });
    await notifyOwner(d.hash, 'client_handover_acknowledged');
    expect(await notifiedFor(d.hash, 'client_handover_acknowledged')).toBe(true);
    expect(await notifiedFor(d.hash, 'client_commented')).toBeNull();
    expect(await notifiedFor(d.hash, 'client_unknown')).toBeNull();
    expect(await notifiedFor('never-minted-hash', 'client_handover_acknowledged')).toBeNull();

    await raw.query(
      `update public.design_engagements set share_expires_at = now() - interval '1 minute'
        where id = '${d.engagementId}'`,
    );
    expect(await notifiedFor(d.hash, 'client_handover_acknowledged')).toBeNull();
    await raw.query(
      `update public.design_engagements set share_expires_at = null where id = '${d.engagementId}'`,
    );
    expect((await revokeDeliveryLinkCore(d.ctx, d.engagementId)).ok).toBe(true);
    expect(await notifiedFor(d.hash, 'client_handover_acknowledged')).toBeNull();
  });
});
