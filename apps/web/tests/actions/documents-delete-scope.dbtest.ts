import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { deleteDocumentCore } from '@/lib/documents/core';
import { DOCUMENT_ENTITIES, type DocumentEntity } from '@/lib/documents/entities';
import { listDocuments } from '@/lib/documents/queries';
import { closeExecutionFixture, ownerQuery, seedClientProject } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Security batch 3, A6: a member deletes their OWN uploads, or any document when
// their role may edit the parent record (owner, admin, project manager). Before
// this the delete was gated on upload alone, so a site engineer or an accountant
// could remove a colleague's file. Rows are written straight into `files` (the
// production path to one is a Storage round trip) and Storage is replaced: what
// is proven is which ROW each role may remove.
vi.mock('@/lib/storage/objects', () => ({ removeStoredObject: async () => {} }));

const ROLES = ['owner', 'admin', 'project_manager', 'site_engineer', 'accountant'] as const;
type Role = (typeof ROLES)[number];
const OWN_ONLY: Role[] = ['site_engineer', 'accountant'];
const ANY: Role[] = ['owner', 'admin', 'project_manager'];

const orgIds: string[] = [];
let orgId: string;
let memberOf: Record<Role, string>;
let parentOf: Record<DocumentEntity, string>;
let otherStudio: { orgId: string; parentOf: Record<DocumentEntity, string> };

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: ROLES.slice(1).map((role) => ({ role })) });
  orgId = seeded.orgId;
  const [admin, project_manager, site_engineer, accountant] = seeded.memberIds;
  memberOf = { owner: seeded.ownerIds[0], admin, project_manager, site_engineer, accountant };
  const parents = await seedClientProject(orgId);
  parentOf = { client: parents.clientId, project: parents.projectId };
  const other = await seedOrg({ owners: 1 });
  const otherParents = await seedClientProject(other.orgId);
  otherStudio = { orgId: other.orgId, parentOf: { client: otherParents.clientId, project: otherParents.projectId } };
  orgIds.push(orgId, other.orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const as = (role: Role): OrgContext => ctxFor(orgId, memberOf[role], role);

/** A `files` row on this studio's client or project (or `at` another parent), uploaded by `createdBy`. */
async function seedFile(
  entity: DocumentEntity,
  createdBy: string | null,
  at: { orgId: string; parentId: string } = { orgId, parentId: parentOf[entity] },
): Promise<string> {
  const id = randomUUID();
  await ownerQuery(
    `insert into public.files (id, org_id, entity, entity_id, object_key, original_name, created_by)
     values ($1, $2, $3, $4, $5, 'plan.pdf', $6)`,
    [id, at.orgId, entity, at.parentId, `${at.orgId}/${entity}/${id}`, createdBy],
  );
  return id;
}

const stillThere = async (fileId: string) => (await ownerQuery(`select 1 from public.files where id = $1`, [fileId])).length === 1;
const auditRows = (fileId: string) =>
  ownerQuery<{ action: string; actor_user_id: string }>(
    `select action, actor_user_id from public.audit_log where org_id = $1 and entity = 'file' and entity_id = $2`,
    [orgId, fileId],
  );

describe.each<DocumentEntity>(['client', 'project'])('deleting a %s document', (entity) => {
  const spec = DOCUMENT_ENTITIES[entity];

  it.each(OWN_ONLY)('%s deletes their own upload: ok, row gone, one audit row (AC6)', async (role) => {
    const file = await seedFile(entity, memberOf[role]);
    expect(await deleteDocumentCore(as(role), spec, file)).toEqual({ ok: true });
    expect(await stillThere(file)).toBe(false);
    expect(await auditRows(file)).toEqual([{ action: 'delete', actor_user_id: memberOf[role] }]);
  });

  it.each(OWN_ONLY)('%s deleting the owner upload: forbidden, row stays, no audit row (AC7)', async (role) => {
    const file = await seedFile(entity, memberOf.owner);
    expect(await deleteDocumentCore(as(role), spec, file)).toEqual({ ok: false, error: 'forbidden' });
    expect(await stillThere(file)).toBe(true);
    expect(await auditRows(file)).toEqual([]);
  });

  it('a site engineer and an accountant cannot delete each other uploads (AC7)', async () => {
    const engineers = await seedFile(entity, memberOf.site_engineer);
    const accountants = await seedFile(entity, memberOf.accountant);
    expect(await deleteDocumentCore(as('accountant'), spec, engineers)).toEqual({ ok: false, error: 'forbidden' });
    expect(await deleteDocumentCore(as('site_engineer'), spec, accountants)).toEqual({ ok: false, error: 'forbidden' });
    expect([await stillThere(engineers), await stillThere(accountants)]).toEqual([true, true]);
  });

  it.each(ANY)('%s deletes a site engineer upload: ok, row gone, one audit row (AC8)', async (role) => {
    const file = await seedFile(entity, memberOf.site_engineer);
    expect(await deleteDocumentCore(as(role), spec, file)).toEqual({ ok: true });
    expect(await stillThere(file)).toBe(false);
    expect(await auditRows(file)).toEqual([{ action: 'delete', actor_user_id: memberOf[role] }]);
  });

  it('a file with no uploader: forbidden for a site engineer, ok for the owner (AC9)', async () => {
    const file = await seedFile(entity, null);
    expect(await deleteDocumentCore(as('site_engineer'), spec, file)).toEqual({ ok: false, error: 'forbidden' });
    expect(await stillThere(file)).toBe(true);
    expect(await deleteDocumentCore(as('owner'), spec, file)).toEqual({ ok: true });
    expect(await stillThere(file)).toBe(false);
  });

  it('an unknown id, a file of the other entity and one of another studio stay record_not_found (AC9)', async () => {
    const otherEntity: DocumentEntity = entity === 'client' ? 'project' : 'client';
    const ofOtherEntity = await seedFile(otherEntity, memberOf.owner);
    const ofOtherStudio = await seedFile(entity, memberOf.site_engineer, { orgId: otherStudio.orgId, parentId: otherStudio.parentOf[entity] });
    for (const fileId of [randomUUID(), ofOtherEntity, ofOtherStudio]) {
      expect(await deleteDocumentCore(as('site_engineer'), spec, fileId)).toEqual({ ok: false, error: 'record_not_found' });
    }
    expect([await stillThere(ofOtherEntity), await stillThere(ofOtherStudio)]).toEqual([true, true]);
  });

  it('listDocuments marks each row deletable for exactly the members who may delete it (AC10)', async () => {
    const engineers = await seedFile(entity, memberOf.site_engineer);
    const owners = await seedFile(entity, memberOf.owner);
    const noUploader = await seedFile(entity, null);
    const deletableFor = async (role: Role) => {
      const listed = await listDocuments(as(role), spec, parentOf[entity]);
      expect(listed.every((document) => !('createdBy' in document)), 'the uploader stays on the server').toBe(true);
      const flags = new Map(listed.map((document) => [document.id, document.deletable]));
      return [engineers, owners, noUploader].map((fileId) => flags.get(fileId));
    };
    expect(await deletableFor('site_engineer')).toEqual([true, false, false]);
    expect(await deletableFor('accountant')).toEqual([false, false, false]);
    for (const role of ANY) expect(await deletableFor(role)).toEqual([true, true, true]);
  });
});
