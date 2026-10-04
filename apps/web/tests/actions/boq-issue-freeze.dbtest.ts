import { afterAll, describe, expect, it, vi } from 'vitest';
import { mutateInOrg } from '@/lib/actions/mutate';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import { freezeAndRecordIssue } from '@/lib/boqs/issue';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// THE WRITE HALF OF EVERY BOQ ISSUE, against a real Postgres.
//
// `freezeAndRecordIssue` is what both the sheet's Issue button and Send as BOQ
// run after the PDF exists. The render itself is Chromium and is not exercised
// here: a `files` row is inserted directly, which is all the write half needs.
// What is asserted is the decision Nabil made for both paths: EVERY issue
// publishes the new `boq` artifact and hides the older visible ones, and a second
// BOQ on the project supersedes the first as the next version.

// The barrel also exports the render half; nothing here renders, and the
// runner has no Chromium, so the renderer is never loaded.
vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Fixture {
  ctx: OrgContext;
  orgId: string;
  projectId: string;
  engagementId: string;
}

async function setup(): Promise<Fixture> {
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
  const [engagement] = await raw.query<{ id: string }>(
    `insert into public.design_engagements (org_id, number, client_id, project_id, title_en)
     values ('${orgId}', 1, '${client.id}', '${project.id}', 'Fit-out design')
     returning id`,
  );
  return { ctx, orgId, projectId: project.id, engagementId: engagement.id };
}

/** A one-line draft BOQ on the fixture's project. */
async function draftBoq(fixture: Fixture): Promise<string> {
  const created = await createBoqCore(fixture.ctx, {
    projectId: fixture.projectId,
    titleEn: 'Bill of Quantities',
  });
  const boqId = (created as { data?: string }).data!;
  await commitImportCore(fixture.ctx, {
    boqId,
    lines: [
      {
        itemCode: '2.01',
        section: 'Gypsum works',
        description: '12mm gypsum ceiling',
        unit: 'sqm',
        qty: '100',
        unitPrice: '1500',
        unitCost: '0',
        costItemCode: null,
        provisional: false,
      },
    ],
  });
  return boqId;
}

async function insertFile(fixture: Fixture, name: string): Promise<string> {
  const [file] = await raw.query<{ id: string }>(
    `insert into public.files (org_id, entity, entity_id, object_key, original_name)
     values ('${fixture.orgId}', 'engagement', '${fixture.engagementId}',
             '${fixture.orgId}/engagement/${name}', '${name}')
     returning id`,
  );
  return file.id;
}

async function insertArtifact(
  fixture: Fixture,
  kind: string,
  fileId: string,
): Promise<string> {
  const [artifact] = await raw.query<{ id: string }>(
    `insert into public.engagement_artifacts
       (org_id, engagement_id, kind, file_id, label, attested_by, client_visible)
     values ('${fixture.orgId}', '${fixture.engagementId}', '${kind}', '${fileId}',
             'shared by hand', '${fixture.ctx.userId}', true)
     returning id`,
  );
  return artifact.id;
}

// Each freeze stores its own PDF, as the real issue path does, so a second
// freeze of the same BOQ must not reuse the first one's object key.
let freezeFileSeq = 0;

async function freeze(fixture: Fixture, boqId: string) {
  freezeFileSeq += 1;
  const fileId = await insertFile(fixture, `${boqId}-${freezeFileSeq}.pdf`);
  return mutateInOrg(fixture.ctx, { capability: 'boq_build', action: 'update' }, (tx) =>
    freezeAndRecordIssue(tx, fixture.ctx, {
      boqId,
      projectId: fixture.projectId,
      engagementId: fixture.engagementId,
      fileId,
      label: 'BQ.pdf',
    }),
  );
}

async function boqRow(boqId: string) {
  const [row] = await raw.query<{
    status: string;
    version: number;
    supersedes_id: string | null;
    engagement_id: string | null;
    issue_date: string | null;
  }>(
    `select status, version, supersedes_id, engagement_id, issue_date::text
       from public.boqs where id = '${boqId}'`,
  );
  return row;
}

async function visible(artifactId: string): Promise<boolean> {
  const [row] = await raw.query<{ client_visible: boolean }>(
    `select client_visible from public.engagement_artifacts where id = '${artifactId}'`,
  );
  return row.client_visible;
}

describe('freezeAndRecordIssue', () => {
  it('issues the BOQ as version 1 and publishes its artifact', async () => {
    const fixture = await setup();
    const boqId = await draftBoq(fixture);

    const res = await freeze(fixture, boqId);
    expect(res.ok).toBe(true);
    expect(res.data?.version).toBe(1);

    const row = await boqRow(boqId);
    expect(row.status).toBe('issued');
    expect(row.version).toBe(1);
    expect(row.supersedes_id).toBeNull();
    expect(row.engagement_id).toBe(fixture.engagementId);
    expect(row.issue_date).not.toBeNull();
    expect(await visible(res.data!.artifactId)).toBe(true);
  });

  it('hides an older, manually shared boq file and leaves other kinds alone', async () => {
    const fixture = await setup();
    const sharedBoqFile = await insertArtifact(
      fixture,
      'boq',
      await insertFile(fixture, 'old-boq.xlsx'),
    );
    const sharedRender = await insertArtifact(
      fixture,
      'approved_render',
      await insertFile(fixture, 'render.png'),
    );

    const res = await freeze(fixture, await draftBoq(fixture));
    expect(res.ok).toBe(true);

    expect(await visible(sharedBoqFile)).toBe(false);
    expect(await visible(sharedRender)).toBe(true);
    expect(await visible(res.data!.artifactId)).toBe(true);
  });

  it('a second BOQ supersedes the first as version 2, and only it is visible', async () => {
    const fixture = await setup();
    const first = await draftBoq(fixture);
    const v1 = await freeze(fixture, first);
    const second = await draftBoq(fixture);
    const v2 = await freeze(fixture, second);

    expect(v2.ok).toBe(true);
    expect(v2.data?.version).toBe(2);
    const row = await boqRow(second);
    expect(row.status).toBe('issued');
    expect(row.version).toBe(2);
    expect(row.supersedes_id).toBe(first);
    expect((await boqRow(first)).status).toBe('superseded');
    expect(await visible(v1.data!.artifactId)).toBe(false);
    expect(await visible(v2.data!.artifactId)).toBe(true);
  });

  it('refuses to freeze the same BOQ twice, and writes no second artifact', async () => {
    const fixture = await setup();
    const boqId = await draftBoq(fixture);
    expect((await freeze(fixture, boqId)).ok).toBe(true);

    expect(await freeze(fixture, boqId)).toEqual({ ok: false, error: 'boq_not_draft' });
    const [count] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.engagement_artifacts
        where engagement_id = '${fixture.engagementId}' and kind = 'boq'`,
    );
    expect(Number(count.n)).toBe(1);
  });
});
