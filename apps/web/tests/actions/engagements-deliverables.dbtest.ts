import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import {
  attachDeliverableCore,
  getDeliverableUrlCore,
} from '@/lib/engagements/deliverable-uploads';
import { createEngagementCore } from '@/lib/engagements/core';
import { deriveWorkingFiles } from '@/lib/engagements/working-files';
import { getEngagementArtifacts } from '@/lib/engagements/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];

afterAll(async () => {
  // Clean up the manually-seeded `files` rows (not in the fixture teardown list)
  // before the org rows go, then the standard teardown.
  for (const orgId of orgIds) {
    await raw.query(`delete from public.files where org_id = '${orgId}'`);
  }
  await teardown(orgIds);
  await closeFixture();
});

/** Seed an org + client + project + one freshly-created (non-terminal) engagement. */
async function setupEngagement(): Promise<{
  ctx: OrgContext;
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
  return { ctx, engagementId };
}

/**
 * Fabricate a `files` row exactly as createSignedUploadUrl would (entity, key),
 * over the BYPASSRLS connection — no Supabase Storage round-trip in the dbtest.
 */
async function seedEngagementFile(
  orgId: string,
  entityId: string,
  createdBy: string,
): Promise<string> {
  const fileId = randomUUID();
  await raw.query(
    `insert into public.files (id, org_id, entity, entity_id, bucket, object_key, created_by)
     values ('${fileId}', '${orgId}', 'engagement', '${entityId}',
             'metra-files', '${orgId}/engagement/${fileId}', '${createdBy}')`,
  );
  return fileId;
}

describe('attachDeliverable — persists file_id into the working-file slot', () => {
  it('layout attach surfaces as hasFile=true on the layout category', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const fileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);

    const res = await attachDeliverableCore(ctx, {
      engagementId,
      category: 'layout',
      fileId,
      label: 'Ground floor',
    });
    expect(res.ok).toBe(true);

    const artifacts = await getEngagementArtifacts(ctx, engagementId);
    const rows = deriveWorkingFiles(artifacts);
    const layout = rows.find((r) => r.category === 'layout')!;
    expect(layout.hasFile).toBe(true);
    expect(layout.version).toBe(1);
    expect(layout.latest?.fileId).toBe(fileId);
  });
});

describe('attachDeliverable — foreign / cross-org file id', () => {
  it('rejects a cross-org file id with invalid and records no artifact', async () => {
    const { ctx: ctxA, engagementId: engA } = await setupEngagement();
    const { ctx: ctxB, engagementId: engB } = await setupEngagement();
    // A file that belongs to org B's engagement, attacked from org A.
    const foreignFileId = await seedEngagementFile(ctxB.orgId, engB, ctxB.userId);

    const res = await attachDeliverableCore(ctxA, {
      engagementId: engA,
      category: 'layout',
      fileId: foreignFileId,
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });

    const artifacts = await getEngagementArtifacts(ctxA, engA);
    expect(artifacts).toHaveLength(0);
  });

  it('rejects a file stamped to a different engagement in the SAME org', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const otherEngagementFileId = await seedEngagementFile(
      ctx.orgId,
      randomUUID(), // some other engagement id
      ctx.userId,
    );
    const res = await attachDeliverableCore(ctx, {
      engagementId,
      category: 'boq',
      fileId: otherEngagementFileId,
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('attachDeliverable — terminal engagement', () => {
  it('rejects with engagement_not_active when the delivery is terminal', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const fileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    await raw.query(
      `update public.design_engagements set state = 'abandoned' where id = '${engagementId}'`,
    );

    const res = await attachDeliverableCore(ctx, {
      engagementId,
      category: 'render',
      fileId,
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_active' });

    const artifacts = await getEngagementArtifacts(ctx, engagementId);
    expect(artifacts).toHaveLength(0);
  });
});

describe('attachDeliverable — re-upload appends (newest wins)', () => {
  it('a second render attach increments the version and shows the newest file', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const firstFileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    const secondFileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);

    expect(
      (
        await attachDeliverableCore(ctx, {
          engagementId,
          category: 'render',
          fileId: firstFileId,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await attachDeliverableCore(ctx, {
          engagementId,
          category: 'render',
          fileId: secondFileId,
        })
      ).ok,
    ).toBe(true);

    const rows = deriveWorkingFiles(await getEngagementArtifacts(ctx, engagementId));
    const render = rows.find((r) => r.category === 'render')!;
    expect(render.version).toBe(2);
    expect(render.hasFile).toBe(true);
    expect(render.latest?.fileId).toBe(secondFileId);
  });
});

describe('getDeliverableUrl — foreign file guard', () => {
  it('rejects a cross-org file id with invalid before any signing', async () => {
    const { ctx: ctxA } = await setupEngagement();
    const { ctx: ctxB, engagementId: engB } = await setupEngagement();
    const foreignFileId = await seedEngagementFile(ctxB.orgId, engB, ctxB.userId);

    const res = await getDeliverableUrlCore(ctxA, foreignFileId);
    expect(res).toEqual({ ok: false, error: 'invalid' });
  });
});
