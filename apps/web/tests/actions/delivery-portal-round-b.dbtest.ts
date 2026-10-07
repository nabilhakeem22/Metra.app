import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it } from 'vitest';
import { executeTransition } from '@/lib/engagements/executor';
import { claimPaymentByToken, recordDeliveryActionByToken } from '@/lib/engagements/public';
import { addDeliveryCommentByToken } from '@/lib/engagements/public-comments';
import { revokeDeliveryLinkCore, rotateDeliveryLinkCore } from '@/lib/engagements/share';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';
import {
  ageUpdatedAt,
  attestAt,
  chooseConcept,
  clientActionsOf,
  forceState,
  portalLetters,
  rendersReadyAtText,
  seedArtifact,
  seedRoundBDelivery,
  setVisible,
  snapshotOf,
  stampRenders,
  updatedAtRefreshed,
} from './round-b-fixture';

// Round B, wave 2 (PR-B9): migration 0056 and the apply-rls functions that use
// it. The notifier has its own suite (delivery-notify-studio.dbtest.ts). Here:
//   * a client DESIGN decision answers ONE render issuance (AC 30, 31);
//   * every `ok` client act refreshes the delivery's updated_at, an `already`
//     does not (AC 32);
//   * the client can choose ONE visible concept option (AC 33) under the letter
//     it saw (0057: letters rank VISIBLE options, the choice SAVES its letter),
//     with the caller's name/ip/ua capped (F4, L3, S2);
//   * a decision the studio retracted answers nothing, read and write alike (L1);
//   * a nonce never outlives its hash, whatever code writes the row (S4);
//   * 0056's constraints exist and bite, and the functions the deployed app
//     calls kept their signatures (AC 35 + backward compatibility).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** The client-channel design decisions, oldest first, with the round each answers. */
async function designDecisions(engagementId: string) {
  return raw.query<{ kind: string; acknowledged_issue_at: string | null }>(
    `select kind::text as kind, acknowledged_issue_at::text as acknowledged_issue_at
       from public.engagement_events
      where engagement_id = '${engagementId}' and actor_channel = 'client'
        and kind in ('design_approval', 'design_change_request')
      order by decided_at, kind`,
  );
}

/** A legacy client design decision: no issuance stamp, decided at `decidedAtSql`. */
async function insertLegacyDesignDecision(
  orgId: string,
  engagementId: string,
  decidedAtSql: string,
): Promise<void> {
  await raw.query(
    `insert into public.engagement_events
       (org_id, engagement_id, kind, actor_channel, decided_at)
     values ('${orgId}', '${engagementId}', 'design_approval', 'client', ${decidedAtSql})`,
  );
}

describe('design decisions answer ONE render issuance (AC 30)', () => {
  it('closes the pair for the round, then re-opens it after a new render issuance', async () => {
    const d = await seedRoundBDelivery(orgIds, 'design-round');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '2 hours'`);
    const roundOne = await rendersReadyAtText(d.engagementId);

    expect(await clientActionsOf(d.hash)).toEqual(['approve_design', 'request_design_changes']);
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_design_changes' }),
    ).toEqual({ ok: true });
    // The other verb of the SAME round is the same decision: a repeat.
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: true,
      code: 'already',
    });
    expect(await clientActionsOf(d.hash)).toEqual([]);
    expect(await designDecisions(d.engagementId)).toEqual([
      { kind: 'design_change_request', acknowledged_issue_at: roundOne },
    ]);

    // The studio revises and issues the renders again: round two.
    await stampRenders(d.engagementId, 'now()');
    const roundTwo = await rendersReadyAtText(d.engagementId);
    expect(roundTwo).not.toBe(roundOne);
    expect(await clientActionsOf(d.hash)).toEqual(['approve_design', 'request_design_changes']);
    // The deployed (pre-Round-B) parser reads the same verbs from the snapshot.
    expect((await deliveryOrNull(d.token))!.clientActions).toContain('approve_design');

    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: true,
    });
    expect(await designDecisions(d.engagementId)).toEqual([
      { kind: 'design_change_request', acknowledged_issue_at: roundOne },
      { kind: 'design_approval', acknowledged_issue_at: roundTwo },
    ]);
    expect(await clientActionsOf(d.hash)).toEqual([]);
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_design_changes' }),
    ).toEqual({ ok: true, code: 'already' });
  });

  it('two concurrent decisions of DIFFERENT kinds in one round land exactly one row', async () => {
    const d = await seedRoundBDelivery(orgIds, 'design-race');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, 'now()');

    const results = await Promise.all([
      recordDeliveryActionByToken(d.token, { action: 'approve_design' }),
      recordDeliveryActionByToken(d.token, { action: 'request_design_changes' }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => 'code' in result && result.code === 'already')).toHaveLength(1);
    expect(await designDecisions(d.engagementId)).toHaveLength(1);
  });

  it('with no render issuance at all, the decision stays one per delivery (legacy)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'design-no-issuance');
    await forceState(d.engagementId, 'final_approval');

    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: true,
    });
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_design_changes' }),
    ).toEqual({ ok: true, code: 'already' });
    expect(await designDecisions(d.engagementId)).toEqual([
      { kind: 'design_approval', acknowledged_issue_at: null },
    ]);
    expect(await clientActionsOf(d.hash)).toEqual([]);
  });

  it('concept decisions are unchanged: one per delivery, never stamped', async () => {
    const d = await seedRoundBDelivery(orgIds, 'concept-unchanged');
    await forceState(d.engagementId, 'concept_review');
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_concept' })).toEqual({
      ok: true,
    });
    const [row] = await raw.query<{ acknowledged_issue_at: string | null }>(
      `select acknowledged_issue_at::text as acknowledged_issue_at from public.engagement_events
        where engagement_id = '${d.engagementId}' and kind = 'concept_approval'`,
    );
    expect(row.acknowledged_issue_at).toBeNull();
  });
});

describe('legacy unstamped design decisions (AC 31)', () => {
  it('one made AFTER the current renders_ready_at closes the pair', async () => {
    const d = await seedRoundBDelivery(orgIds, 'legacy-after');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '1 day'`);
    await insertLegacyDesignDecision(d.orgId, d.engagementId, `now() - interval '1 hour'`);

    expect(await clientActionsOf(d.hash)).toEqual([]);
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: true,
      code: 'already',
    });
    expect(await designDecisions(d.engagementId)).toHaveLength(1);
  });

  it('one made BEFORE the current renders_ready_at belongs to an earlier round', async () => {
    const d = await seedRoundBDelivery(orgIds, 'legacy-before');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '1 hour'`);
    await insertLegacyDesignDecision(d.orgId, d.engagementId, `now() - interval '2 days'`);
    const current = await rendersReadyAtText(d.engagementId);

    expect(await clientActionsOf(d.hash)).toEqual(['approve_design', 'request_design_changes']);
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: true,
    });
    expect(await designDecisions(d.engagementId)).toEqual([
      { kind: 'design_approval', acknowledged_issue_at: null },
      { kind: 'design_approval', acknowledged_issue_at: current },
    ]);
  });
});

describe('every ok client act refreshes updated_at, an already does not (AC 32)', () => {
  it('respond', async () => {
    const d = await seedRoundBDelivery(orgIds, 'touch-respond');
    await forceState(d.engagementId, 'concept_review');
    await ageUpdatedAt(d.engagementId);
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_concept' })).toEqual({
      ok: true,
    });
    expect(await updatedAtRefreshed(d.engagementId)).toBe(true);

    await ageUpdatedAt(d.engagementId);
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_concept' })).toEqual({
      ok: true,
      code: 'already',
    });
    expect(await updatedAtRefreshed(d.engagementId)).toBe(false);
    // A refusal touches nothing either.
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: false,
      error: 'wrong_state',
    });
    expect(await updatedAtRefreshed(d.engagementId)).toBe(false);
  });

  it('payment claim', async () => {
    const d = await seedRoundBDelivery(orgIds, 'touch-claim');
    const fee = await executeTransition(d.ctx, {
      engagementId: d.engagementId,
      trigger: 'submitDesignFee',
      payload: {
        designFee: '100000',
        milestones: [
          { kind: 'deposit', basis: 'amount', value: '30000' },
          { kind: 'gate_a', basis: 'amount', value: '20000' },
          { kind: 'gate_b', basis: 'amount', value: '25000' },
          { kind: 'balance', basis: 'amount', value: '25000' },
        ],
      },
    });
    expect(fee.ok).toBe(true);
    await ageUpdatedAt(d.engagementId);
    expect(await claimPaymentByToken(d.token, { milestoneKind: 'deposit' })).toEqual({ ok: true });
    expect(await updatedAtRefreshed(d.engagementId)).toBe(true);

    await ageUpdatedAt(d.engagementId);
    expect(await claimPaymentByToken(d.token, { milestoneKind: 'deposit' })).toEqual({
      ok: true,
      code: 'already',
    });
    expect(await updatedAtRefreshed(d.engagementId)).toBe(false);
  });

  it('comment', async () => {
    const d = await seedRoundBDelivery(orgIds, 'touch-comment');
    const documentId = await seedArtifact(d, 'approved_render');
    await ageUpdatedAt(d.engagementId);
    expect(
      (await addDeliveryCommentByToken(d.token, { documentId, body: 'The marble looks dark' }))
        .ok,
    ).toBe(true);
    expect(await updatedAtRefreshed(d.engagementId)).toBe(true);

    await ageUpdatedAt(d.engagementId);
    expect(await addDeliveryCommentByToken(d.token, { documentId, body: '   ' })).toEqual({
      ok: false,
      error: 'empty',
    });
    expect(await updatedAtRefreshed(d.engagementId)).toBe(false);
  });

  it('choose concept', async () => {
    const d = await seedRoundBDelivery(orgIds, 'touch-choose');
    await forceState(d.engagementId, 'concept_review');
    const option = await seedArtifact(d, 'concept_option');
    await ageUpdatedAt(d.engagementId);
    expect(await chooseConcept(d.hash, option, 1)).toBe('ok');
    expect(await updatedAtRefreshed(d.engagementId)).toBe(true);

    await ageUpdatedAt(d.engagementId);
    expect(await chooseConcept(d.hash, option, 1)).toBe('already');
    expect(await updatedAtRefreshed(d.engagementId)).toBe(false);
  });
});

/** The client concept approvals with the option each one names. */
async function conceptApprovals(engagementId: string) {
  return raw.query<{
    actor_channel: string;
    chosen_artifact_id: string | null;
    chosen_position: number | null;
    note: string | null;
    actor_name: string | null;
  }>(
    `select actor_channel, chosen_artifact_id, chosen_position, note, actor_name
       from public.engagement_events
      where engagement_id = '${engagementId}' and kind = 'concept_approval'
      order by decided_at`,
  );
}

describe('the client chooses ONE concept option (AC 33)', () => {
  it('numbers the visible options, records the choice, and closes the decision', async () => {
    const d = await seedRoundBDelivery(orgIds, 'choose');
    await forceState(d.engagementId, 'concept_review');
    const optionA = await seedArtifact(d, 'concept_option');
    const optionB = await seedArtifact(d, 'concept_option');
    const hidden = await seedArtifact(d, 'concept_option', { release: false });
    const fileless = await seedArtifact(d, 'concept_option', { withFile: false, release: false });
    // A file-less option forced visible (BYPASSRLS): the portal cannot show it,
    // so it is neither listed nor choosable.
    await raw.query(
      `update public.engagement_artifacts set client_visible = true where id = '${fileless}'`,
    );
    // B was attested FIRST, so it is option 1: the order is (attested_at, id),
    // not the order the rows happened to be inserted in.
    await raw.query(
      `update public.engagement_artifacts set attested_at = now() - interval '1 day'
        where id = '${optionB}'`,
    );

    const before = await snapshotOf(d.hash);
    expect(before!.concept_options).toEqual([
      { id: optionB, position: 1 },
      { id: optionA, position: 2 },
    ]);
    expect(before!.concept_choice_id).toBeNull();

    for (const position of [1, 2, 3]) {
      expect(await chooseConcept(d.hash, hidden, position)).toBe('wrong_state');
      expect(await chooseConcept(d.hash, fileless, position)).toBe('wrong_state');
    }
    expect(await chooseConcept(d.hash, optionA, 2, 'The second one, please')).toBe('ok');

    expect(await conceptApprovals(d.engagementId)).toEqual([
      {
        actor_channel: 'client',
        chosen_artifact_id: optionA,
        chosen_position: 2,
        note: 'The second one, please',
        actor_name: 'Client Sam',
      },
    ]);
    const after = await snapshotOf(d.hash);
    expect(after!.concept_choice_id).toBe(optionA);
    expect(after!.concept_choice_position).toBe(2);
    expect(after!.client_actions).toEqual([]);
    // The deployed parser still reads the snapshot with the two new keys in it.
    expect((await deliveryOrNull(d.token))!.clientActions).toEqual([]);

    // One decision per delivery: a second choice, or approving on top, repeats.
    expect(await chooseConcept(d.hash, optionB, 1)).toBe('already');
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_concept' })).toEqual({
      ok: true,
      code: 'already',
    });
    expect(await conceptApprovals(d.engagementId)).toHaveLength(1);
    // No state move: the studio still advances.
    const [state] = await raw.query<{ state: string }>(
      `select state from public.design_engagements where id = '${d.engagementId}'`,
    );
    expect(state.state).toBe('concept_review');
  });

  it('a change request already on file makes a later choice a repeat', async () => {
    const d = await seedRoundBDelivery(orgIds, 'choose-after-changes');
    await forceState(d.engagementId, 'concept_review');
    const option = await seedArtifact(d, 'concept_option');
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_concept_changes' }),
    ).toEqual({ ok: true });
    expect(await chooseConcept(d.hash, option, 1)).toBe('already');
    expect(await conceptApprovals(d.engagementId)).toEqual([]);
  });

  it('refuses anything that is not a visible option of THIS delivery, as wrong_state', async () => {
    const d = await seedRoundBDelivery(orgIds, 'choose-refusals');
    const other = await seedRoundBDelivery(orgIds, 'choose-other-org');
    await forceState(d.engagementId, 'concept_review');
    await forceState(other.engagementId, 'concept_review');
    const render = await seedArtifact(d, 'approved_render');
    const foreignOption = await seedArtifact(other, 'concept_option');
    const ownOption = await seedArtifact(d, 'concept_option');

    expect(await chooseConcept(d.hash, render, 1)).toBe('wrong_state');
    expect(await chooseConcept(d.hash, foreignOption, 1)).toBe('wrong_state');
    expect(await chooseConcept(d.hash, null, 1)).toBe('wrong_state');
    expect(await chooseConcept(d.hash, '00000000-0000-4000-8000-000000000000', 1)).toBe(
      'wrong_state',
    );
    expect(await conceptApprovals(d.engagementId)).toEqual([]);
    expect(await conceptApprovals(other.engagementId)).toEqual([]);

    // Outside concept_review the visible option is refused too.
    await forceState(d.engagementId, 'final_approval');
    expect(await chooseConcept(d.hash, ownOption, 1)).toBe('wrong_state');
    await forceState(d.engagementId, 'abandoned');
    expect(await chooseConcept(d.hash, ownOption, 1)).toBe('not_active');
    expect(await conceptApprovals(d.engagementId)).toEqual([]);
  });

  it('answers expired, invalid and revoked links like the other token writes', async () => {
    const d = await seedRoundBDelivery(orgIds, 'choose-links');
    await forceState(d.engagementId, 'concept_review');
    const option = await seedArtifact(d, 'concept_option');

    expect(await chooseConcept('not-a-real-hash', option, 1)).toBe('invalid');
    await raw.query(
      `update public.design_engagements set share_expires_at = now() - interval '1 day'
        where id = '${d.engagementId}'`,
    );
    expect(await chooseConcept(d.hash, option, 1)).toBe('expired');
    expect((await revokeDeliveryLinkCore(d.ctx, d.engagementId)).ok).toBe(true);
    expect(await chooseConcept(d.hash, option, 1)).toBe('invalid');
    expect(await conceptApprovals(d.engagementId)).toEqual([]);
  });

  it('two concurrent choices land exactly one row', async () => {
    const d = await seedRoundBDelivery(orgIds, 'choose-race');
    await forceState(d.engagementId, 'concept_review');
    const optionA = await seedArtifact(d, 'concept_option');
    const optionB = await seedArtifact(d, 'concept_option');

    await attestAt(optionA, '2026-01-01T00:00:00Z');
    await attestAt(optionB, '2026-01-02T00:00:00Z');
    const codes = await Promise.all([
      chooseConcept(d.hash, optionA, 1),
      chooseConcept(d.hash, optionB, 2),
    ]);
    expect([...codes].sort()).toEqual(['already', 'ok']);
    expect(await conceptApprovals(d.engagementId)).toHaveLength(1);
  });
});

/** Retract an event the way the studio's correction path does: a new row pointing at it. */
async function retract(orgId: string, engagementId: string, eventId: string): Promise<void> {
  await raw.query(
    `insert into public.engagement_events (org_id, engagement_id, kind, supersedes_event_id)
     values ('${orgId}', '${engagementId}', 'event_correction', '${eventId}')`,
  );
}

async function latestClientEventId(engagementId: string, kind: string): Promise<string> {
  const [row] = await raw.query<{ id: string }>(
    `select id from public.engagement_events
      where engagement_id = '${engagementId}' and actor_channel = 'client' and kind = '${kind}'
      order by decided_at desc limit 1`,
  );
  return row.id;
}

describe('letters rank VISIBLE options; a choice keeps the letter it was made under (0057)', () => {
  it('hiding an option renumbers the later ones, but never a saved choice', async () => {
    const d = await seedRoundBDelivery(orgIds, 'visible-letters');
    await forceState(d.engagementId, 'concept_review');
    const first = await seedArtifact(d, 'concept_option');
    const second = await seedArtifact(d, 'concept_option');
    const third = await seedArtifact(d, 'concept_option');
    await attestAt(first, '2026-01-01T00:00:00Z');
    await attestAt(second, '2026-01-02T00:00:00Z');
    await attestAt(third, '2026-01-03T00:00:00Z');

    // The studio hides option A: B and C become A and B for the client.
    await setVisible(first, false);
    expect(await portalLetters(d.hash)).toEqual([
      [second, 1],
      [third, 2],
    ]);
    expect(await chooseConcept(d.hash, third, 2)).toBe('ok');

    // The studio now hides the chosen option and releases the first again.
    await setVisible(third, false);
    await setVisible(first, true);
    expect(await portalLetters(d.hash)).toEqual([
      [first, 1],
      [second, 2],
    ]);
    const snapshot = await snapshotOf(d.hash);
    // The choice still reads as the letter the client saw (B).
    expect(snapshot!.concept_choice_id).toBe(third);
    expect(snapshot!.concept_choice_position).toBe(2);
    // A stale double submit answers `already` before the option is looked at.
    expect(await chooseConcept(d.hash, third, 2)).toBe('already');
  });

  it('never lists or accepts a position above 4', async () => {
    const d = await seedRoundBDelivery(orgIds, 'position-cap');
    await forceState(d.engagementId, 'concept_review');
    const options: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      options.push(await seedArtifact(d, 'concept_option'));
    }
    // The app stops at 4 (CONCEPT_OPTION_MAX); a fifth row can still exist in
    // the table, written outside the app, and must never become choosable.
    const [fifth] = await raw.query<{ id: string }>(
      `insert into public.engagement_artifacts
         (org_id, engagement_id, kind, attested_by, file_id, client_visible, attested_at)
       select org_id, engagement_id, kind, attested_by, file_id, true, now() + interval '1 day'
         from public.engagement_artifacts where id = '${options[0]}'
       returning id`,
    );
    const snapshot = await snapshotOf(d.hash);
    expect((snapshot!.concept_options as Array<{ position: number }>).map((o) => o.position)).toEqual([
      1, 2, 3, 4,
    ]);
    for (const position of [4, 5]) {
      expect(await chooseConcept(d.hash, fifth.id, position)).toBe('wrong_state');
    }
    expect(await conceptApprovals(d.engagementId)).toEqual([]);
  });
});

describe('the choice caps what the client sends, like the comment function (S2)', () => {
  it('stores at most 120 / 45 / 512 characters of name / ip / user agent, trimmed', async () => {
    const d = await seedRoundBDelivery(orgIds, 'choose-caps');
    await forceState(d.engagementId, 'concept_review');
    const option = await seedArtifact(d, 'concept_option');
    const [result] = await raw.query<{ code: string }>(
      `select public.app_delivery_choose_concept_by_token(
         '${d.hash}', '${option}'::uuid, 1, null,
         '   ${'n'.repeat(300)}', '${'i'.repeat(100)}', '${'u'.repeat(900)}'
       ) as code`,
    );
    expect(result.code).toBe('ok');
    const [row] = await raw.query<{ name: number; ip: number; agent: number }>(
      `select length(actor_name) as name, length(actor_ip) as ip, length(actor_user_agent) as agent
         from public.engagement_events where engagement_id = '${d.engagementId}'`,
    );
    expect(row).toEqual({ name: 120, ip: 45, agent: 512 });

    const blank = await seedRoundBDelivery(orgIds, 'choose-caps-blank');
    await forceState(blank.engagementId, 'concept_review');
    const blankOption = await seedArtifact(blank, 'concept_option');
    await raw.query(
      `select public.app_delivery_choose_concept_by_token(
         '${blank.hash}', '${blankOption}'::uuid, 1, null, '   ', '', '') as code`,
    );
    const [empty] = await raw.query<{ name: string | null; ip: string | null; agent: string | null }>(
      `select actor_name as name, actor_ip as ip, actor_user_agent as agent
         from public.engagement_events where engagement_id = '${blank.engagementId}'`,
    );
    expect(empty).toEqual({ name: null, ip: null, agent: null });
  });
});

describe('a retracted client decision answers nothing, as liveEvents() in TS (L1)', () => {
  it('design: the retracted verb stays closed (its slot is taken), the other re-opens', async () => {
    const d = await seedRoundBDelivery(orgIds, 'retract-design');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '1 hour'`);
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_design_changes' }),
    ).toEqual({ ok: true });
    await retract(
      d.orgId,
      d.engagementId,
      await latestClientEventId(d.engagementId, 'design_change_request'),
    );

    expect(await clientActionsOf(d.hash)).toEqual(['approve_design']);
    // Read and write agree on the closed verb...
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_design_changes' }),
    ).toEqual({ ok: true, code: 'already' });
    // ...and on the open one.
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: true,
    });
    expect(await clientActionsOf(d.hash)).toEqual([]);
  });

  it('a retracted legacy design decision no longer closes the round', async () => {
    const d = await seedRoundBDelivery(orgIds, 'retract-legacy');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '1 day'`);
    await insertLegacyDesignDecision(d.orgId, d.engagementId, `now() - interval '1 hour'`);
    expect(await clientActionsOf(d.hash)).toEqual([]);
    await retract(d.orgId, d.engagementId, await latestClientEventId(d.engagementId, 'design_approval'));

    expect(await clientActionsOf(d.hash)).toEqual(['approve_design', 'request_design_changes']);
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({
      ok: true,
    });
  });

  it('concept: a retracted choice is no longer the choice, and changes can be asked', async () => {
    const d = await seedRoundBDelivery(orgIds, 'retract-concept');
    await forceState(d.engagementId, 'concept_review');
    const option = await seedArtifact(d, 'concept_option');
    expect(await chooseConcept(d.hash, option, 1)).toBe('ok');
    await retract(d.orgId, d.engagementId, await latestClientEventId(d.engagementId, 'concept_approval'));

    const snapshot = await snapshotOf(d.hash);
    expect(snapshot!.concept_choice_id).toBeNull();
    expect(snapshot!.concept_choice_position).toBeNull();
    expect(snapshot!.client_actions).toEqual(['request_concept_changes']);
    // The approval slot is still taken by the retracted row: both writes agree.
    expect(await chooseConcept(d.hash, option, 1)).toBe('already');
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_concept' })).toEqual({
      ok: true,
      code: 'already',
    });
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_concept_changes' }),
    ).toEqual({ ok: true });
  });
});

describe('0056 constraints exist and bite (AC 33, 35)', () => {
  it('creates the three named constraints, the index and both columns', async () => {
    const [constraints] = await raw.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where conname in ('engagement_events_chosenArtifact_same_org_fk',
                          'engagement_events_chosen_artifact_only_concept',
                          'design_engagements_token_nonce_needs_hash')`,
    );
    expect(Number(constraints.n)).toBe(3);
    const [fk] = await raw.query<{ action: string }>(
      `select confdeltype::text as action from pg_constraint
        where conname = 'engagement_events_chosenArtifact_same_org_fk'`,
    );
    expect(fk.action).toBe('a'); // NO ACTION
    const indexes = await raw.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'engagement_events_chosenArtifact_idx'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('(org_id, chosen_artifact_id)');
    const columns = await raw.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `select table_name, column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and column_name in ('token_nonce', 'chosen_artifact_id')
        order by column_name`,
    );
    expect(columns).toEqual([
      { table_name: 'engagement_events', column_name: 'chosen_artifact_id', is_nullable: 'YES' },
      { table_name: 'design_engagements', column_name: 'token_nonce', is_nullable: 'YES' },
    ]);
  });

  it('refuses a chosen option on any kind but concept_approval (23514)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'check-kind');
    const option = await seedArtifact(d, 'concept_option');
    const failure = await raw
      .query(
        `insert into public.engagement_events
           (org_id, engagement_id, kind, chosen_artifact_id, chosen_position)
         values ('${d.orgId}', '${d.engagementId}', 'design_approval', '${option}', 1)`,
      )
      .catch((error: unknown) => error);
    expect(sqlstateOf(failure)).toBe('23514');
    // The same pointer on a concept approval is accepted (staff channel here),
    // with the letter 0057 pairs it with.
    await raw.query(
      `insert into public.engagement_events
         (org_id, engagement_id, kind, chosen_artifact_id, chosen_position)
       values ('${d.orgId}', '${d.engagementId}', 'concept_approval', '${option}', 1)`,
    );
  });

  it("refuses a pointer at another org's artifact (23503, same-org FK)", async () => {
    const d = await seedRoundBDelivery(orgIds, 'fk-org-a');
    const other = await seedRoundBDelivery(orgIds, 'fk-org-b');
    const foreignOption = await seedArtifact(other, 'concept_option');
    const failure = await raw
      .query(
        `insert into public.engagement_events
           (org_id, engagement_id, kind, chosen_artifact_id, chosen_position)
         values ('${d.orgId}', '${d.engagementId}', 'concept_approval', '${foreignOption}', 1)`,
      )
      .catch((error: unknown) => error);
    expect(sqlstateOf(failure)).toBe('23503');
  });

  it('refuses a statement that sets a nonce with no hash (23514)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'nonce-check');
    const failure = await raw
      .query(
        `update public.design_engagements set token_hash = null, token_nonce = 'nonce-value'
          where id = '${d.engagementId}'`,
      )
      .catch((error: unknown) => error);
    expect(sqlstateOf(failure)).toBe('23514');

    // The app's revoke (through RLS, as metra_app) clears both in one write.
    expect((await revokeDeliveryLinkCore(d.ctx, d.engagementId)).ok).toBe(true);
    expect(await linkColumns(d.engagementId)).toEqual({ token_hash: null, token_nonce: null });
  });
});

async function linkColumns(engagementId: string) {
  const [row] = await raw.query<{ token_hash: string | null; token_nonce: string | null }>(
    `select token_hash, token_nonce from public.design_engagements where id = '${engagementId}'`,
  );
  return row;
}

describe('a nonce never outlives its hash (trg_design_engagements_token_nonce, S4)', () => {
  // The statements below are exactly what main (pre-Round-B) and any Worker
  // rolled back past this batch send: they change token_hash and never name
  // token_nonce. Without the trigger the revoke would fail the CHECK with 23514
  // once a nonce exists, and the rotate would pair the new hash with the old
  // link's nonce.
  it('the pre-Round-B revoke clears the nonce instead of failing', async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-revoke');
    await raw.query(
      `update public.design_engagements set token_nonce = 'n1' where id = '${d.engagementId}'`,
    );
    await raw.query(
      `update public.design_engagements set token_hash = null, share_expires_at = null,
              updated_at = now()
        where id = '${d.engagementId}'`,
    );
    expect(await linkColumns(d.engagementId)).toEqual({ token_hash: null, token_nonce: null });
  });

  it('the pre-Round-B rotate drops the old nonce; a writer that sets one keeps it', async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-rotate');
    await raw.query(
      `update public.design_engagements set token_nonce = 'n1' where id = '${d.engagementId}'`,
    );
    await raw.query(
      `update public.design_engagements set token_hash = 'rotated-hash-1'
        where id = '${d.engagementId}'`,
    );
    expect(await linkColumns(d.engagementId)).toEqual({
      token_hash: 'rotated-hash-1',
      token_nonce: null,
    });

    // The Round B mint/rotate writes both in one statement: the nonce stays.
    await raw.query(
      `update public.design_engagements set token_hash = 'rotated-hash-2', token_nonce = 'n2'
        where id = '${d.engagementId}'`,
    );
    // An update that does not touch the hash leaves the nonce alone.
    await raw.query(
      `update public.design_engagements set updated_at = now() where id = '${d.engagementId}'`,
    );
    expect(await linkColumns(d.engagementId)).toEqual({
      token_hash: 'rotated-hash-2',
      token_nonce: 'n2',
    });
  });

  it('the app rotate (as metra_app, through RLS) also drops a stale nonce', async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-app-rotate');
    await raw.query(
      `update public.design_engagements set token_nonce = 'n1' where id = '${d.engagementId}'`,
    );
    expect((await rotateDeliveryLinkCore(d.ctx, d.engagementId)).ok).toBe(true);
    const row = await linkColumns(d.engagementId);
    expect(row.token_hash).not.toBe(d.hash);
    expect(row.token_nonce).toBeNull();
  });

  it('exists as a BEFORE UPDATE row trigger on design_engagements', async () => {
    const rows = await raw.query<{ timing_before: boolean; for_row: boolean; on_update: boolean }>(
      `select (t.tgtype & 2) <> 0 as timing_before, (t.tgtype & 1) <> 0 as for_row,
              (t.tgtype & 16) <> 0 as on_update
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relname = 'design_engagements'
          and t.tgname = 'trg_design_engagements_token_nonce' and not t.tgisinternal`,
    );
    expect(rows).toEqual([{ timing_before: true, for_row: true, on_update: true }]);
  });
});

describe('the functions the deployed app calls kept their signatures', () => {
  // The owner applies this batch BEFORE the app that uses it is deployed, so the
  // live code calls these with the old argument lists in between. One overload
  // each, same arguments, same return type.
  const EXPECTED: Record<string, { args: string; result: string }> = {
    app_delivery_by_token: { args: 'p_hash text', result: 'jsonb' },
    app_delivery_respond_by_token: {
      args: 'p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text',
      result: 'text',
    },
    app_delivery_claim_payment_by_token: {
      args: 'p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text',
      result: 'text',
    },
    app_delivery_comment_by_token: {
      args: 'p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text',
      result: 'text',
    },
    // 0057 dropped the 6-argument version (no deployed caller) and created this
    // one: the letter the client saw is the third argument.
    app_delivery_choose_concept_by_token: {
      args: 'p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text',
      result: 'text',
    },
    app_delivery_act_notified_by_token: {
      args: 'p_hash text, p_body_key text, p_milestone_kind text',
      result: 'boolean',
    },
    app_concept_option_positions: {
      args: 'p_engagement_id uuid',
      result: 'TABLE(artifact_id uuid, option_position integer)',
    },
    app_delivery_notify_studio_by_token: {
      args: 'p_hash text, p_body_key text, p_params jsonb, p_roles jsonb',
      result: 'jsonb',
    },
  };

  it('has exactly one overload of each, with the expected arguments and result', async () => {
    const rows = await raw.query<{ name: string; args: string; result: string }>(
      `select p.proname as name,
              pg_get_function_identity_arguments(p.oid) as args,
              pg_get_function_result(p.oid) as result
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (${Object.keys(EXPECTED)
          .map((name) => `'${name}'`)
          .join(', ')})
        order by p.proname`,
    );
    expect(rows).toHaveLength(Object.keys(EXPECTED).length);
    for (const row of rows) {
      expect({ name: row.name, args: row.args, result: row.result }).toEqual({
        name: row.name,
        ...EXPECTED[row.name],
      });
    }
  });

  it('runs the token functions as SECURITY DEFINER with an empty search_path, metra_app only', async () => {
    const rows = await raw.query<{
      name: string;
      definer: boolean;
      config: string[] | null;
      app_can_execute: boolean;
      public_grants: number;
    }>(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('metra_app', p.oid, 'execute') as app_can_execute,
              (select count(*)::int
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                where acl.grantee = 0) as public_grants
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('app_delivery_choose_concept_by_token',
                            'app_delivery_notify_studio_by_token',
                            'app_delivery_act_notified_by_token')
        order by p.proname`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.definer).toBe(true);
      expect(row.config).toEqual(['search_path=""']);
      expect(row.app_can_execute).toBe(true);
      expect(Number(row.public_grants)).toBe(0);
    }
  });

  it('the lettering rule is INVOKER (RLS-scoped from the studio), granted to metra_app only', async () => {
    const [row] = await raw.query<{
      definer: boolean;
      config: string[] | null;
      app_can_execute: boolean;
      public_grants: number;
    }>(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('metra_app', p.oid, 'execute') as app_can_execute,
              (select count(*)::int
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                where acl.grantee = 0) as public_grants
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'app_concept_option_positions'`,
    );
    expect(row).toEqual({
      definer: false,
      config: ['search_path=""'],
      app_can_execute: true,
      public_grants: 0,
    });
  });

  it('no new function, nor the read snapshot, mentions a pricing column', async () => {
    const rows = await raw.query<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc
        where proname in ('app_delivery_by_token', 'app_delivery_choose_concept_by_token',
                          'app_delivery_notify_studio_by_token',
                          'app_delivery_act_notified_by_token', 'app_concept_option_positions')`,
    );
    expect(rows).toHaveLength(5);
    const FORBIDDEN = /unit_cost|line_cost|total_cost|margin|supervision|build_cost/;
    for (const row of rows) expect(FORBIDDEN.test(row.prosrc)).toBe(false);
  });
});
