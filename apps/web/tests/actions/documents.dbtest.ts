import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { deleteDocumentCore, getDocumentUrlCore } from '@/lib/documents/core';
import { createDocumentUploadCore } from '@/lib/documents/upload';
import { DOCUMENT_ENTITIES } from '@/lib/documents/entities';
import { listDocuments } from '@/lib/documents/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

// `lib/client-documents/` and `lib/project-documents/` were byte-identical twins
// with NO database coverage at all. Merging them into one spec-driven module is
// only safe if the thing that used to be implicit — that a client endpoint and a
// project endpoint cannot reach each other's files — is now pinned explicitly.
//
// The happy upload path is deliberately absent: `createDocumentUploadCore` ends
// in Supabase Storage (`ensureFilesBucket` + a signed PUT), which is not part of
// this suite's contract. Every REFUSAL it can return happens before that call,
// and those are what matter for tenancy.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Org {
  orgId: string;
  ctx: OrgContext;
  memberIds: string[];
  clientId: string;
  projectId: string;
}

async function seedOrgWithParents(): Promise<Org> {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: [{ role: 'site_engineer' }, { role: 'viewer' }],
  });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    clientId: client.id,
    code: 'P',
    nameEn: 'Fit-out',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
  });
  const [project] = await listProjects(ctx, {});
  return { orgId, ctx, memberIds, clientId: client.id, projectId: project.id };
}

/**
 * Insert a `files` row directly. The production path to one is a Storage round
 * trip, and every assertion below is about what the DATABASE row lets the cores
 * do, so the row is written on the fixture's connection rather than faked.
 */
async function seedFile(
  orgId: string,
  entity: 'client' | 'project',
  entityId: string,
): Promise<string> {
  const id = randomUUID();
  await raw.query(
    `insert into public.files (id, org_id, entity, entity_id, object_key, original_name)
     values ('${id}', '${orgId}', '${entity}', '${entityId}',
             '${orgId}/${entity}/${id}', 'plan.pdf')`,
  );
  return id;
}

const auditRowsFor = (orgId: string, fileId: string) =>
  raw.query<{ action: string; entity: string }>(
    `select action, entity from public.audit_log
      where org_id = '${orgId}' and entity = 'file' and entity_id = '${fileId}'`,
  );

describe('documents: the upload gate', () => {
  it('refuses a role without the entity write capability', async () => {
    // client_activity and project_activity both exclude viewer. The gate is the
    // action, not the hidden button — server actions are directly invokable.
    const { orgId, memberIds, clientId, projectId } = await seedOrgWithParents();
    const viewer = ctxFor(orgId, memberIds[1], 'viewer');
    expect(
      await createDocumentUploadCore(viewer, DOCUMENT_ENTITIES.client, {
        parentId: clientId,
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await createDocumentUploadCore(viewer, DOCUMENT_ENTITIES.project, {
        parentId: projectId,
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('lets an operational role through the capability gate', async () => {
    // A site_engineer holds client_activity:create, so the refusal it gets for a
    // FORGED parent id is `invalid` — proving the capability check passed and the
    // parent lookup is what refused.
    const { orgId, memberIds } = await seedOrgWithParents();
    const engineer = ctxFor(orgId, memberIds[0], 'site_engineer');
    expect(
      await createDocumentUploadCore(engineer, DOCUMENT_ENTITIES.client, {
        parentId: randomUUID(),
      }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses a parent id that is not a uuid, before any query', async () => {
    const { ctx } = await seedOrgWithParents();
    expect(
      await createDocumentUploadCore(ctx, DOCUMENT_ENTITIES.client, {
        parentId: 'not-a-uuid',
      }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses a parent that belongs to ANOTHER org', async () => {
    // `files.entity_id` is polymorphic and carries no foreign key, so this check
    // is the only thing between a forged id and a file stapled to another tenant.
    const mine = await seedOrgWithParents();
    const theirs = await seedOrgWithParents();
    expect(
      await createDocumentUploadCore(mine.ctx, DOCUMENT_ENTITIES.client, {
        parentId: theirs.clientId,
      }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses a parent of the WRONG entity — a project id is not a client', async () => {
    const { ctx, projectId } = await seedOrgWithParents();
    expect(
      await createDocumentUploadCore(ctx, DOCUMENT_ENTITIES.client, {
        parentId: projectId,
      }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses a category id from another org', async () => {
    const { ctx, clientId } = await seedOrgWithParents();
    expect(
      await createDocumentUploadCore(ctx, DOCUMENT_ENTITIES.client, {
        parentId: clientId,
        categoryId: randomUUID(),
      }),
    ).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('documents: listing', () => {
  it('lists only this parent, of this entity, in this org', async () => {
    const mine = await seedOrgWithParents();
    const theirs = await seedOrgWithParents();
    const clientFile = await seedFile(mine.orgId, 'client', mine.clientId);
    await seedFile(mine.orgId, 'project', mine.projectId);
    await seedFile(theirs.orgId, 'client', theirs.clientId);

    const listed = await listDocuments(
      mine.ctx,
      DOCUMENT_ENTITIES.client,
      mine.clientId,
    );
    expect(listed.map((d) => d.id)).toEqual([clientFile]);
    expect(listed[0].originalName).toBe('plan.pdf');
  });

  it('does not leak another org files through a forged parent id', async () => {
    const mine = await seedOrgWithParents();
    const theirs = await seedOrgWithParents();
    await seedFile(theirs.orgId, 'client', theirs.clientId);
    expect(
      await listDocuments(mine.ctx, DOCUMENT_ENTITIES.client, theirs.clientId),
    ).toEqual([]);
  });
});

describe('documents: the cross-entity guard', () => {
  it('refuses a PROJECT file id handed to deleteClientDocument', async () => {
    // The merge's headline risk: one module now serves two entities, so a file id
    // from the other one must not be deletable through the wrong action.
    const { orgId, ctx, projectId } = await seedOrgWithParents();
    const projectFile = await seedFile(orgId, 'project', projectId);
    expect(
      await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, projectFile),
    ).toEqual({ ok: false, error: 'invalid' });
    // And it is still there.
    expect(
      await raw.query(`select id from public.files where id = '${projectFile}'`),
    ).toHaveLength(1);
  });

  it('refuses a CLIENT file id handed to deleteProjectDocument', async () => {
    // The other direction. It used to be a second SELECT's business and is now
    // the DELETE's own `where`, so the statement that gates is the statement
    // that writes — there is no window between proving ownership and removing.
    const { orgId, ctx, clientId } = await seedOrgWithParents();
    const clientFile = await seedFile(orgId, 'client', clientId);
    expect(
      await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.project, clientFile),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await raw.query(`select id from public.files where id = '${clientFile}'`),
    ).toHaveLength(1);
    expect(await auditRowsFor(orgId, clientFile)).toHaveLength(0);
  });

  it('refuses a PROJECT file id handed to getClientDocumentUrl', async () => {
    // Only the REFUSAL is asserted. The success path ends in Supabase Storage
    // (`getSignedUrl`), which this suite does not stand up — so asserting on it
    // would be asserting on the availability of a third party, not on the guard.
    const { orgId, ctx, projectId } = await seedOrgWithParents();
    const projectFile = await seedFile(orgId, 'project', projectId);
    expect(
      await getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, projectFile),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses a file id from another org to the URL mint', async () => {
    const mine = await seedOrgWithParents();
    const theirs = await seedOrgWithParents();
    const theirFile = await seedFile(theirs.orgId, 'client', theirs.clientId);
    expect(
      await getDocumentUrlCore(mine.ctx, DOCUMENT_ENTITIES.client, theirFile),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses the URL mint to a role without the entity READ capability', async () => {
    // `clients` read excludes nobody operational, so the refusable role here is
    // the client role — fenced out of the internal app entirely.
    const { orgId, ctx, clientId } = await seedOrgWithParents();
    const file = await seedFile(orgId, 'client', clientId);
    const asClient = { ...ctx, role: 'client' as const };
    expect(
      await getDocumentUrlCore(asClient, DOCUMENT_ENTITIES.client, file),
    ).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('documents: delete', () => {
  it('refuses a file id from ANOTHER org, and leaves it alone', async () => {
    const mine = await seedOrgWithParents();
    const theirs = await seedOrgWithParents();
    const theirFile = await seedFile(theirs.orgId, 'client', theirs.clientId);
    expect(
      await deleteDocumentCore(mine.ctx, DOCUMENT_ENTITIES.client, theirFile),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await raw.query(`select id from public.files where id = '${theirFile}'`),
    ).toHaveLength(1);
    // And no audit row was written into the calling org for a refused delete.
    expect(await auditRowsFor(mine.orgId, theirFile)).toHaveLength(0);
  });

  it('refuses a role without the write capability', async () => {
    const { orgId, memberIds, clientId } = await seedOrgWithParents();
    const viewer = ctxFor(orgId, memberIds[1], 'viewer');
    const file = await seedFile(orgId, 'client', clientId);
    expect(
      await deleteDocumentCore(viewer, DOCUMENT_ENTITIES.client, file),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await raw.query(`select id from public.files where id = '${file}'`),
    ).toHaveLength(1);
  });

  it('deletes the row AND writes exactly one audit entry', async () => {
    const { orgId, ctx, clientId } = await seedOrgWithParents();
    const file = await seedFile(orgId, 'client', clientId);
    expect((await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, file)).ok).toBe(
      true,
    );
    expect(
      await raw.query(`select id from public.files where id = '${file}'`),
    ).toHaveLength(0);
    const audits = await auditRowsFor(orgId, file);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('delete');
  });

  it('is not idempotent by accident — a second delete is a coded refusal', async () => {
    const { orgId, ctx, clientId } = await seedOrgWithParents();
    const file = await seedFile(orgId, 'client', clientId);
    expect((await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, file)).ok).toBe(
      true,
    );
    expect(
      await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, file),
    ).toEqual({ ok: false, error: 'invalid' });
    // Still exactly one audit row: the refused second call wrote nothing.
    expect(await auditRowsFor(orgId, file)).toHaveLength(1);
  });
});
