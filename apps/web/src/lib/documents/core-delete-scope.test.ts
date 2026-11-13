// Which rows deleteDocumentCore's DELETE may touch, and what it answers when it
// touched none (security batch 3, A6). The database is replaced, so what is
// proven here is the predicate the DELETE is given and the branch taken; the
// same rules against a real Postgres, with real roles and RLS, are in
// tests/actions/documents-delete-scope.dbtest.ts.
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/context', () => ({ withOrgContext: vi.fn() }));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => false, cfExecutionContext: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => ({ getSignedUrl: vi.fn() }));
const removeStoredObject = vi.fn(async (_bucket: string, _objectKey: string) => {});
vi.mock('@/lib/storage/objects', () => ({
  removeStoredObject: (bucket: string, objectKey: string) => removeStoredObject(bucket, objectKey),
}));

const deletedRows = vi.fn<() => unknown[]>();
const rowStillThere = vi.fn<() => unknown>();
const deletePredicates: SQL[] = [];
const auditEntries: unknown[] = [];
const tx = {
  delete: () => ({
    where: (predicate: SQL) => {
      deletePredicates.push(predicate);
      return { returning: () => deletedRows() };
    },
  }),
  select: () => ({ from: () => ({ where: () => ({ limit: () => [rowStillThere()].filter(Boolean) }) }) }),
};
vi.mock('@/lib/actions/mutate', async () => {
  const result = await vi.importActual<typeof import('@/lib/actions/result')>('@/lib/actions/result');
  return {
    fail: result.fail,
    mutateInOrg: async (_ctx: unknown, _opts: unknown, fn: (tx: unknown, audit: (entry: unknown) => Promise<void>) => Promise<unknown>) => {
      try {
        return { ok: true, data: await fn(tx, async (entry) => void auditEntries.push(entry)) };
      } catch (error) {
        return { ok: false, error: error instanceof result.ActionError ? error.code : 'generic' };
      }
    },
  };
});

const { deleteDocumentCore } = await import('./core');
const { DOCUMENT_ENTITIES } = await import('./entities');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';
const STORED = { bucket: 'metra-files', objectKey: 'org-1/project/file-1' };
const as = (role: OrgContext['role']): OrgContext => ({ orgId: 'org-1', userId: USER_ID, role });
const deletePredicate = () => new PgDialect().sqlToQuery(deletePredicates[0]);

beforeEach(() => {
  deletedRows.mockReset();
  rowStillThere.mockReset();
  removeStoredObject.mockClear();
  deletePredicates.length = 0;
  auditEntries.length = 0;
});

describe.each(['site_engineer', 'accountant'] as const)('%s deletes only their own upload', (role) => {
  it('the DELETE itself carries "uploaded by me", next to the file and entity guards', async () => {
    deletedRows.mockReturnValue([STORED]);
    expect(await deleteDocumentCore(as(role), DOCUMENT_ENTITIES.project, FILE_ID)).toEqual({ ok: true });
    expect(deletePredicate().sql).toBe('("files"."id" = $1 and "files"."entity" = $2 and "files"."created_by" = $3)');
    expect(deletePredicate().params).toEqual([FILE_ID, 'project', USER_ID]);
    expect(auditEntries).toHaveLength(1);
    expect(removeStoredObject).toHaveBeenCalledWith(STORED.bucket, STORED.objectKey);
  });

  it('answers `forbidden` when the file is there but is not theirs: no audit row, no bytes removed', async () => {
    deletedRows.mockReturnValue([]);
    rowStillThere.mockReturnValue({ id: FILE_ID, originalName: 'signed-agreement.pdf' });
    expect(await deleteDocumentCore(as(role), DOCUMENT_ENTITIES.client, FILE_ID)).toEqual({ ok: false, error: 'forbidden' });
    expect(auditEntries).toHaveLength(0);
    expect(removeStoredObject).not.toHaveBeenCalled();
  });

  it('answers `record_not_found` when no such file is visible at all', async () => {
    deletedRows.mockReturnValue([]);
    rowStillThere.mockReturnValue(undefined);
    expect(await deleteDocumentCore(as(role), DOCUMENT_ENTITIES.client, FILE_ID)).toEqual({ ok: false, error: 'record_not_found' });
    expect(rowStillThere).toHaveBeenCalledTimes(1);
    expect(auditEntries).toHaveLength(0);
  });
});

describe.each(['owner', 'admin', 'project_manager'] as const)('%s deletes any document of the entity', (role) => {
  it('the DELETE carries no uploader predicate', async () => {
    deletedRows.mockReturnValue([STORED]);
    expect(await deleteDocumentCore(as(role), DOCUMENT_ENTITIES.client, FILE_ID)).toEqual({ ok: true });
    expect(deletePredicate().sql).toBe('("files"."id" = $1 and "files"."entity" = $2)');
    expect(deletePredicate().params).toEqual([FILE_ID, 'client']);
  });

  it('answers `record_not_found` for no row back, without the extra read', async () => {
    deletedRows.mockReturnValue([]);
    expect(await deleteDocumentCore(as(role), DOCUMENT_ENTITIES.project, FILE_ID)).toEqual({ ok: false, error: 'record_not_found' });
    expect(rowStillThere).not.toHaveBeenCalled();
  });
});
