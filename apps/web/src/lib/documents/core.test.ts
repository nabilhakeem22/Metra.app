// What the document reads and deletes ANSWER when the parts around them fail.
// The database and Storage are both replaced: the tenancy filters themselves are
// proven against a real Postgres in tests/actions/documents.dbtest.ts, and what a
// unit test can prove is the branch taken and the code returned.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

vi.mock('server-only', () => ({}));

const ownedRow = vi.fn<() => unknown>();
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) =>
    fn({
      select: () => ({
        from: () => ({ where: () => ({ limit: () => [ownedRow()].filter(Boolean) }) }),
      }),
    }),
}));

const getSignedUrl = vi.fn<() => Promise<string>>();
const removeStoredObject = vi.fn<(...args: string[]) => Promise<void>>();
vi.mock('@/lib/storage', () => ({
  getSignedUrl: () => getSignedUrl(),
  removeStoredObject: (bucket: string, objectKey: string) =>
    removeStoredObject(bucket, objectKey),
}));

// The spine, with its transaction and its audit replaced but its CONTRACT kept:
// an ActionError becomes its code, anything else becomes `generic`, and the
// callback's return value rides out as `data`. The capability gate and the real
// RLS refusals are proven in tests/actions/documents.dbtest.ts.
const deletedRows = vi.fn<() => unknown[]>();
const auditEntries: unknown[] = [];
vi.mock('@/lib/actions/mutate', async () => {
  const result = await vi.importActual<typeof import('@/lib/actions/result')>(
    '@/lib/actions/result',
  );
  return {
    fail: result.fail,
    ActionError: result.ActionError,
    mutateInOrg: async (
      _ctx: unknown,
      _opts: unknown,
      fn: (tx: unknown, audit: (entry: unknown) => Promise<void>) => Promise<unknown>,
    ) => {
      const tx = {
        delete: () => ({ where: () => ({ returning: () => deletedRows() }) }),
      };
      try {
        const data = await fn(tx, async (entry) => {
          auditEntries.push(entry);
        });
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof result.ActionError ? error.code : 'generic',
        };
      }
    },
  };
});

import { deleteDocumentCore, getDocumentUrlCore } from './core';
import { DOCUMENT_ENTITIES } from './entities';

const ctx = {
  orgId: 'org-1',
  userId: 'user-1',
  userEmail: 'studio@example.com',
  role: 'owner',
} as OrgContext;

beforeEach(() => {
  ownedRow.mockReset();
  getSignedUrl.mockReset();
  removeStoredObject.mockReset();
  deletedRows.mockReset();
  auditEntries.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getDocumentUrlCore', () => {
  it('signs a URL for a file of this entity in this org', async () => {
    ownedRow.mockReturnValue({ id: 'file-1' });
    getSignedUrl.mockResolvedValue('https://storage.example/signed');
    await expect(
      getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: true, url: 'https://storage.example/signed' });
  });

  it('answers `invalid` for a file this entity does not own — and never signs', async () => {
    ownedRow.mockReturnValue(undefined);
    await expect(
      getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.project, 'file-1'),
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('answers `generic` and LOGS when Storage fails, not `invalid`', async () => {
    // The not-found answer is decided before the try. An outage answering
    // `invalid` told the studio the file no longer exists — and told the log
    // nothing at all, so on-call could not tell an outage from a junk id.
    ownedRow.mockReturnValue({ id: 'file-1' });
    getSignedUrl.mockRejectedValue(new Error('storage 503'));
    await expect(
      getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: false, error: 'generic' });
    expect(console.error).toHaveBeenCalledWith(
      'document url mint failed',
      expect.objectContaining({ fileId: 'file-1', entity: 'client' }),
    );
  });

  it('answers `forbidden` to a role that cannot read the parent record', async () => {
    // `clients` is the one capability row with an empty cell for `client`.
    const clientRole = { ...ctx, role: 'client' } as OrgContext;
    await expect(
      getDocumentUrlCore(clientRole, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('deleteDocumentCore', () => {
  const storedObject = { bucket: 'metra-files', objectKey: 'org-1/client/file-1' };

  it('deletes the bytes too, AFTER the row is gone', async () => {
    // Nothing in the product deleted a stored object at all, so every document
    // a studio ever deleted left its bytes in the bucket forever.
    deletedRows.mockReturnValue([storedObject]);
    await expect(
      deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: true });
    expect(removeStoredObject).toHaveBeenCalledWith(
      storedObject.bucket,
      storedObject.objectKey,
    );
    expect(auditEntries).toHaveLength(1);
  });

  it('does not leak the object key back to the caller', async () => {
    // This rides out through a 'use server' action; the bucket path is plumbing.
    deletedRows.mockReturnValue([storedObject]);
    const answer = await deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1');
    expect(Object.keys(answer)).toEqual(['ok']);
  });

  it('still answers ok when Storage refuses the remove — the row IS deleted', async () => {
    deletedRows.mockReturnValue([storedObject]);
    removeStoredObject.mockRejectedValue(new Error('storage 503'));
    await expect(
      deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: true });
    expect(console.error).toHaveBeenCalledWith(
      'document object remove failed',
      expect.objectContaining(storedObject),
    );
  });

  it('answers `invalid` and removes NOTHING when the gated delete returns no row', async () => {
    // Another org's file (RLS), another entity's file, or one already deleted.
    deletedRows.mockReturnValue([]);
    await expect(
      deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(removeStoredObject).not.toHaveBeenCalled();
    expect(auditEntries).toHaveLength(0);
  });
});
