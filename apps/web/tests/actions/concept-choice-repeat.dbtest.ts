import { afterAll, describe, expect, it } from 'vitest';
import { chooseConceptAndNotify } from '@/lib/engagements/client-acts/choose-concept';
import { offlineConceptOptions, chosenConceptOf } from '@/lib/engagements/concept-choice';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { getEngagementArtifacts, getEngagementEvents } from '@/lib/engagements/queries';
import { closeFixture, raw, teardown } from './fixture';
import {
  attestAt,
  forceState,
  seedArtifact,
  seedRoundBDelivery,
  setVisible,
  type RoundBDelivery,
} from './round-b-fixture';

// B12 fix round, against the real write, read and notifier:
//   F1: a choose that answers `already` names only the decision SAVED on file,
//       never the option the stale tab tapped, and notifies that decision;
//   F5: a choose after the review closed says the step moved on, a stale letter
//       while it is open says the options changed;
//   F2: after hide, choose and re-release, the studio reads ONE letter for the
//       client's pick (the saved one) and the offline select offers nothing.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Two released options X (A) and Y (B), at concept_review, with an owner and an admin. */
async function twoOptions(suffix: string): Promise<RoundBDelivery & { x: string; y: string }> {
  const d = await seedRoundBDelivery(orgIds, suffix, [{ role: 'admin' }]);
  await forceState(d.engagementId, 'concept_review');
  const x = await seedArtifact(d, 'concept_option');
  const y = await seedArtifact(d, 'concept_option');
  await attestAt(x, '2026-01-01T00:00:00Z');
  await attestAt(y, '2026-01-02T00:00:00Z');
  return { ...d, x, y };
}

async function bodyKeys(orgId: string): Promise<string[]> {
  const rows = await raw.query<{ body_key: string }>(
    `select distinct body_key from public.notifications where org_id = '${orgId}' order by 1`,
  );
  return rows.map((row) => row.body_key);
}

describe('F1: a repeat choice names only the SAVED decision', () => {
  it('two tabs: B is chosen first; the stale tab tapping A is told B', async () => {
    const d = await twoOptions('f1-two-tabs');
    expect(await chooseConceptAndNotify(d.token, { artifactId: d.y, position: 2 })).toEqual({
      kind: 'chosen',
      letter: 'B',
      studioNotified: true,
    });
    expect(await chooseConceptAndNotify(d.token, { artifactId: d.x, position: 1 })).toEqual({
      kind: 'chosen',
      letter: 'B',
      studioNotified: true,
    });
    const rows = await raw.query<{ chosen_artifact_id: string; chosen_position: number }>(
      `select chosen_artifact_id, chosen_position from public.engagement_events
        where engagement_id = '${d.engagementId}' and kind = 'concept_approval'`,
    );
    expect(rows).toEqual([{ chosen_artifact_id: d.y, chosen_position: 2 }]);
    expect(await bodyKeys(d.orgId)).toEqual(['client_concept_chosen']);
  });

  it('over a request for changes: the request is what is confirmed, with no letter', async () => {
    const d = await twoOptions('f1-changes');
    expect(
      await recordDeliveryActionByToken(d.token, { action: 'request_concept_changes' }),
    ).toEqual({ ok: true });
    // The request's own notification was never written (no wrapper above), so
    // the repeat repairs THAT one: never a "client chose" notification.
    expect(await chooseConceptAndNotify(d.token, { artifactId: d.x, position: 1 })).toEqual({
      kind: 'changes_requested',
      studioNotified: true,
    });
    expect(await bodyKeys(d.orgId)).toEqual(['client_concept_changes_requested']);
  });

  it('over a plain approval: approved, with no letter', async () => {
    const d = await twoOptions('f1-approved');
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_concept' })).toEqual({ ok: true });
    expect(await chooseConceptAndNotify(d.token, { artifactId: d.y, position: 2 })).toEqual({
      kind: 'approved',
      studioNotified: true,
    });
    expect(await bodyKeys(d.orgId)).toEqual(['client_concept_approved']);
  });
});

describe('F5: why a choice was refused', () => {
  it('a letter that moved while the review is open: the options changed', async () => {
    const d = await twoOptions('f5-changed');
    await setVisible(d.x, false);
    // The client saw Y as B; it is A now.
    expect(await chooseConceptAndNotify(d.token, { artifactId: d.y, position: 2 })).toEqual({
      kind: 'options_changed',
    });
  });

  it('the review closed: the step moved on, nothing written, nobody notified', async () => {
    const d = await twoOptions('f5-moved-on');
    await forceState(d.engagementId, 'negotiation');
    expect(await chooseConceptAndNotify(d.token, { artifactId: d.x, position: 1 })).toEqual({
      kind: 'moved_on',
    });
    expect(await bodyKeys(d.orgId)).toEqual([]);
  });

  it('any other refusal is the portal error key', async () => {
    const d = await twoOptions('f5-expired');
    await raw.query(
      `update public.design_engagements set share_expires_at = now() - interval '1 minute'
        where id = '${d.engagementId}'`,
    );
    expect(await chooseConceptAndNotify(d.token, { artifactId: d.x, position: 1 })).toEqual({
      kind: 'error',
      error: 'token_expired',
    });
  });
});

describe('F2: hide, choose, re-release: one letter for the client pick', () => {
  it('the studio reads the SAVED letter for the pick; the offline select is closed', async () => {
    const d = await seedRoundBDelivery(orgIds, 'f2-sequence');
    await forceState(d.engagementId, 'concept_review');
    const t1 = await seedArtifact(d, 'concept_option');
    const t2 = await seedArtifact(d, 'concept_option');
    const t3 = await seedArtifact(d, 'concept_option');
    await attestAt(t1, '2026-01-01T00:00:00Z');
    await attestAt(t2, '2026-01-02T00:00:00Z');
    await attestAt(t3, '2026-01-03T00:00:00Z');
    await setVisible(t2, false);
    expect(await chooseConceptAndNotify(d.token, { artifactId: t3, position: 2 })).toMatchObject({
      kind: 'chosen',
      letter: 'B',
    });
    await setVisible(t2, true);

    const artifacts = await getEngagementArtifacts(d.ctx, d.engagementId);
    const positionOf = (id: string) => artifacts.find((artifact) => artifact.id === id)?.conceptPosition;
    // Current letters: t2 is B again and t3 is C...
    expect([positionOf(t1), positionOf(t2), positionOf(t3)]).toEqual([1, 2, 3]);
    // ...but the client's pick is t3 under the SAVED letter B, everywhere.
    expect(chosenConceptOf(await getEngagementEvents(d.ctx, d.engagementId))).toEqual({
      artifactId: t3,
      letter: 'B',
    });
    const preview = await getEngagementGatePreview(d.ctx, d.engagementId);
    expect(preview.clientDecision).toMatchObject({ chosenArtifactId: t3, chosenPosition: 2 });
    expect(offlineConceptOptions(artifacts, preview.clientDecision)).toEqual([]);
  });
});
