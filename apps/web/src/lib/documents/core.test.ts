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
vi.mock('@/lib/storage', () => ({
  getSignedUrl: () => getSignedUrl(),
}));

import { getDocumentUrlCore } from './core';
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
