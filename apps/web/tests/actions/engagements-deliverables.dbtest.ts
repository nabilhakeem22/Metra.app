import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import {
  attachDeliverableCore,
  getDeliverableUrlCore,
} from '@/lib/engagements/deliverable-uploads';
import { createEngagementCore } from '@/lib/engagements/core';
import { renewDeliverableUploadCore } from '@/lib/engagements/deliverable-upload-renew';
import { deriveWorkingFiles } from '@/lib/engagements/working-files';
import { getEngagementArtifacts } from '@/lib/engagements/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Storage is not in the dbtest: a renewed signed URL is its object key on a fake host.
const storage = vi.hoisted(() => ({
  renewSignedUploadUrl: vi.fn(async (objectKey: string) => ({ signedUrl: `https://storage.test/${objectKey}` })),
}));
vi.mock('@/lib/storage/uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage/uploads')>()),
  renewSignedUploadUrl: storage.renewSignedUploadUrl,
}));

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
    startDate: '2026-01-01', endDate: '2026-06-30',
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

describe('a retried attach is the artifact already recorded (F5)', () => {
  it('attaching the same upload twice records ONE concept option and answers its id both times', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const fileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    const first = await attachDeliverableCore(ctx, { engagementId, category: 'conceptOption', fileId });
    const again = await attachDeliverableCore(ctx, { engagementId, category: 'conceptOption', fileId });
    expect(first.ok && again.ok).toBe(true);
    expect(again.data).toBe(first.data);
    const [row] = await raw.query<{ count: number }>(
      `select count(*)::int as count from public.engagement_artifacts
        where engagement_id = '${engagementId}' and file_id = '${fileId}'`,
    );
    expect(Number(row.count)).toBe(1);
  });

  it('a retried attach of the fourth option is not refused as a fifth', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const fileIds: string[] = [];
    for (let option = 0; option < 4; option += 1) {
      const fileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
      fileIds.push(fileId);
      expect((await attachDeliverableCore(ctx, { engagementId, category: 'conceptOption', fileId })).ok).toBe(true);
    }
    expect((await attachDeliverableCore(ctx, { engagementId, category: 'conceptOption', fileId: fileIds[3] })).ok).toBe(true);
    const fifth = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    expect(await attachDeliverableCore(ctx, { engagementId, category: 'conceptOption', fileId: fifth })).toEqual({
      ok: false,
      error: 'concept_options_out_of_range',
    });
  });
});

describe('renewDeliverableUpload reuses the files row of a failed upload (R3)', () => {
  it('signs the SAME object again for an unattached upload of this delivery', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const fileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    const [before] = await raw.query<{ count: number }>(`select count(*)::int as count from public.files where org_id = '${ctx.orgId}'`);
    const renewed = await renewDeliverableUploadCore(ctx, { engagementId, fileId });
    expect(renewed).toEqual({ fileId, signedUrl: `https://storage.test/${ctx.orgId}/engagement/${fileId}` });
    const [after] = await raw.query<{ count: number }>(`select count(*)::int as count from public.files where org_id = '${ctx.orgId}'`);
    expect(Number(after.count)).toBe(Number(before.count));
  });

  it('a Storage failure is a coded generic, never a throw through the action', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const fileId = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    storage.renewSignedUploadUrl.mockRejectedValueOnce(new Error('storage down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(renewDeliverableUploadCore(ctx, { engagementId, fileId })).resolves.toEqual({
      ok: false,
      error: 'generic',
    });
    quiet.mockRestore();
  });

  it('refuses an attached file, another delivery or org file, and a closed delivery', async () => {
    const { ctx, engagementId } = await setupEngagement();
    const attached = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    await attachDeliverableCore(ctx, { engagementId, category: 'layout', fileId: attached });
    expect(await renewDeliverableUploadCore(ctx, { engagementId, fileId: attached })).toEqual({ ok: false, error: 'invalid' });

    const { ctx: other, engagementId: otherEngagement } = await setupEngagement();
    const foreign = await seedEngagementFile(other.orgId, otherEngagement, other.userId);
    expect(await renewDeliverableUploadCore(ctx, { engagementId, fileId: foreign })).toEqual({ ok: false, error: 'invalid' });

    const pending = await seedEngagementFile(ctx.orgId, engagementId, ctx.userId);
    await raw.query(`update public.design_engagements set state = 'abandoned' where id = '${engagementId}'`);
    expect(await renewDeliverableUploadCore(ctx, { engagementId, fileId: pending })).toEqual({
      ok: false,
      error: 'engagement_not_active',
    });
  });
});
