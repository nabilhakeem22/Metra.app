import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { setArtifactClientVisibilityCore } from '@/lib/engagements/client-visibility';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementArtifacts } from '@/lib/engagements/queries';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Client Deliverables, Step 1 — the AUTO-SHARE path and its manual override.
// Proves: a release-carrying transition flips exactly the right artifacts (never a
// survey, NEVER a boq); a guard failure flips nothing at all; and the per-file
// manual toggle is org-scoped and capability-gated.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const AMOUNT_SPLIT: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

/** Every artifact of an engagement, as id -> { kind, client_visible }. */
async function visibilityMap(
  engagementId: string,
): Promise<Map<string, { kind: string; visible: boolean }>> {
  const rows = await raw.query<{ id: string; kind: string; client_visible: boolean }>(
    `select id, kind, client_visible from public.engagement_artifacts
     where engagement_id = '${engagementId}'`,
  );
  return new Map(
    rows.map((row) => [row.id, { kind: row.kind, visible: row.client_visible === true }]),
  );
}

/** A real `files` row (the artifact -> file link has no FK, but the portal SDF
 *  joins `files`, so the fixtures use genuine rows throughout). */
async function seedFile(orgId: string, engagementId: string): Promise<string> {
  const fileId = randomUUID();
  await raw.query(
    `insert into public.files (id, org_id, entity, entity_id, bucket, object_key, original_name)
     values ('${fileId}', '${orgId}', 'engagement', '${engagementId}',
             'metra-files', '${orgId}/engagement/${fileId}', 'drawing.pdf')`,
  );
  return fileId;
}

/** Record one artifact and return its id. */
async function recordArtifact(
  ctx: OrgContext,
  engagementId: string,
  kind: Parameters<typeof recordArtifactCore>[1]['kind'],
  fileId: string | null,
): Promise<string> {
  const res = await recordArtifactCore(ctx, { engagementId, kind, fileId });
  expect(res.ok).toBe(true);
  return res.data!;
}

/** Seed an org + client + project and drive ONE engagement to `layout`. */
async function setupLayout(): Promise<{
  ctx: OrgContext;
  orgId: string;
  engagementId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
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
  await recordArtifact(ctx, engagementId, 'survey', await seedFile(orgId, engagementId));
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' })).ok,
  ).toBe(true);
  expect(await stateOf(engagementId)).toBe('layout');
  return { ctx, orgId, engagementId };
}

describe('auto-share — optionsReady releases the concept package', () => {
  it('flips the file-bearing concept options + the NEWEST autocad, and nothing else', async () => {
    const { ctx, orgId, engagementId } = await setupLayout();

    const optionA = await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    const optionB = await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    // A third option with NO file: it satisfies the 2–4 guard but has nothing to
    // download, so it must stay hidden.
    const optionFileless = await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      null,
    );
    const cadOld = await recordArtifact(
      ctx,
      engagementId,
      'autocad',
      await seedFile(orgId, engagementId),
    );
    const cadNew = await recordArtifact(
      ctx,
      engagementId,
      'autocad',
      await seedFile(orgId, engagementId),
    );
    // A BOQ and a second survey sitting in the same engagement: NEITHER may ever be
    // auto-shared (the BOQ can carry the firm's own rates).
    const boq = await recordArtifact(
      ctx,
      engagementId,
      'boq',
      await seedFile(orgId, engagementId),
    );
    const survey = await recordArtifact(
      ctx,
      engagementId,
      'survey',
      await seedFile(orgId, engagementId),
    );
    // Force a deterministic ordering for the two CAD sets.
    await raw.query(
      `update public.engagement_artifacts set attested_at = now() - interval '2 days'
       where id = '${cadOld}'`,
    );

    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok,
    ).toBe(true);
    expect(await stateOf(engagementId)).toBe('concept_review');

    const visibility = await visibilityMap(engagementId);
    expect(visibility.get(optionA)!.visible).toBe(true);
    expect(visibility.get(optionB)!.visible).toBe(true);
    expect(visibility.get(cadNew)!.visible).toBe(true);

    expect(visibility.get(optionFileless)!.visible).toBe(false);
    expect(visibility.get(cadOld)!.visible).toBe(false);
    expect(visibility.get(boq)!.visible).toBe(false);
    expect(visibility.get(survey)!.visible).toBe(false);
    // Every survey in the engagement (including the spatial base) stays hidden.
    for (const row of visibility.values()) {
      if (row.kind === 'boq' || row.kind === 'survey') expect(row.visible).toBe(false);
    }
  });

  it('never REVOKES: an artifact shared manually stays shared through a release', async () => {
    const { ctx, orgId, engagementId } = await setupLayout();
    const boq = await recordArtifact(
      ctx,
      engagementId,
      'boq',
      await seedFile(orgId, engagementId),
    );
    expect(
      (await setArtifactClientVisibilityCore(ctx, { artifactId: boq, visible: true })).ok,
    ).toBe(true);

    await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok,
    ).toBe(true);

    const visibility = await visibilityMap(engagementId);
    expect(visibility.get(boq)!.visible).toBe(true);
  });
});

describe('auto-share — a guard failure flips nothing', () => {
  it('optionsReady with ONE concept option: rejected, state unchanged, all hidden', async () => {
    const { ctx, orgId, engagementId } = await setupLayout();
    await recordArtifact(
      ctx,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    await recordArtifact(
      ctx,
      engagementId,
      'autocad',
      await seedFile(orgId, engagementId),
    );

    const res = await executeTransition(ctx, { engagementId, trigger: 'optionsReady' });
    expect(res).toEqual({ ok: false, error: 'concept_options_out_of_range' });
    expect(await stateOf(engagementId)).toBe('layout');

    const visibility = await visibilityMap(engagementId);
    expect([...visibility.values()].every((row) => row.visible === false)).toBe(true);
  });

  it('a cross-org caller cannot fire the release on another org’s engagement', async () => {
    const { ctx: ctxA, orgId, engagementId } = await setupLayout();
    await recordArtifact(
      ctxA,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );
    await recordArtifact(
      ctxA,
      engagementId,
      'concept_option',
      await seedFile(orgId, engagementId),
    );

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await executeTransition(ctxB, { engagementId, trigger: 'optionsReady' });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(engagementId)).toBe('layout');
    const visibility = await visibilityMap(engagementId);
    expect([...visibility.values()].every((row) => row.visible === false)).toBe(true);
  });
});

describe('manual override — setArtifactClientVisibilityCore', () => {
  it('round-trips show -> hide -> show and surfaces on the read model', async () => {
    const { ctx, orgId, engagementId } = await setupLayout();
    const artifactId = await recordArtifact(
      ctx,
      engagementId,
      'boq',
      await seedFile(orgId, engagementId),
    );

    const before = await getEngagementArtifacts(ctx, engagementId);
    expect(before.find((a) => a.id === artifactId)!.clientVisible).toBe(false);

    expect(
      await setArtifactClientVisibilityCore(ctx, { artifactId, visible: true }),
    ).toEqual({ ok: true, data: undefined });
    expect(
      (await getEngagementArtifacts(ctx, engagementId)).find((a) => a.id === artifactId)!
        .clientVisible,
    ).toBe(true);

    expect(
      (await setArtifactClientVisibilityCore(ctx, { artifactId, visible: false })).ok,
    ).toBe(true);
    expect(
      (await getEngagementArtifacts(ctx, engagementId)).find((a) => a.id === artifactId)!
        .clientVisible,
    ).toBe(false);

    // Idempotent: setting the value it already has is a safe no-op.
    expect(
      (await setArtifactClientVisibilityCore(ctx, { artifactId, visible: false })).ok,
    ).toBe(true);
  });

  it('a FILELESS artifact can never be marked visible', async () => {
    const { ctx, engagementId } = await setupLayout();
    const artifactId = await recordArtifact(ctx, engagementId, 'boq', null);
    expect(
      await setArtifactClientVisibilityCore(ctx, { artifactId, visible: true }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('a FOREIGN artifact reads as invalid and is NOT flipped', async () => {
    const { ctx: ctxA, orgId, engagementId } = await setupLayout();
    const artifactId = await recordArtifact(
      ctxA,
      engagementId,
      'boq',
      await seedFile(orgId, engagementId),
    );

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    expect(
      await setArtifactClientVisibilityCore(ctxB, { artifactId, visible: true }),
    ).toEqual({ ok: false, error: 'invalid' });
    const visibility = await visibilityMap(engagementId);
    expect(visibility.get(artifactId)!.visible).toBe(false);
  });

  it('an absent / malformed artifact id is invalid', async () => {
    const { ctx } = await setupLayout();
    expect(
      await setArtifactClientVisibilityCore(ctx, {
        artifactId: randomUUID(),
        visible: true,
      }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await setArtifactClientVisibilityCore(ctx, {
        artifactId: 'not-a-uuid',
        visible: true,
      }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('a viewer is forbidden and the artifact stays hidden', async () => {
    const { orgId: viewerOrg, ownerIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'viewer' }],
    });
    orgIds.push(viewerOrg);
    const owner = ctxFor(viewerOrg, ownerIds[0], 'owner');
    await createClientCore(owner, { phone: '01000000000', nameEn: 'Acme viewer' });
    const [client] = await listClients(owner, {});
    await createProjectCore(owner, {
      code: `PRJ-${viewerOrg.slice(0, 8)}`,
      nameEn: 'Tower',
      clientId: client.id,
      status: 'active',
    });
    const [project] = await listProjects(owner, {});
    const created = await createEngagementCore(owner, {
      titleEn: 'Villa',
      clientId: client.id,
      projectId: project.id,
    });
    const engagementId = (created as { data?: string }).data!;
    const artifactId = await recordArtifact(
      owner,
      engagementId,
      'boq',
      await seedFile(viewerOrg, engagementId),
    );

    const [viewerId] = (await raw.memberships(viewerOrg))
      .filter((m) => m.role === 'viewer')
      .map((m) => m.user_id);
    const viewer = ctxFor(viewerOrg, viewerId, 'viewer');

    expect(
      await setArtifactClientVisibilityCore(viewer, { artifactId, visible: true }),
    ).toEqual({ ok: false, error: 'forbidden' });
    const visibility = await visibilityMap(engagementId);
    expect(visibility.get(artifactId)!.visible).toBe(false);
  });
});
