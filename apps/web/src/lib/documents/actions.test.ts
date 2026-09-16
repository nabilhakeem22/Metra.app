// The revalidate RULE, at the only layer that owns it.
//
// `refreshApp()` is a Next `revalidatePath`, so it cannot run in a unit test; it
// is replaced by a counter. What is worth pinning is not that revalidation
// happens but WHICH outcomes it happens for — `uncertain` is the one a reader
// deletes by accident, and the cost of getting it wrong is a deleted file still
// listed on every server-rendered surface.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';

const refreshApp = vi.fn();
vi.mock('@/lib/actions/refresh', () => ({ refreshApp: () => refreshApp() }));

const orgContext = {
  orgId: 'org-1',
  userId: 'user-1',
  userEmail: 'studio@example.com',
  role: 'owner',
};
vi.mock('@/lib/auth/require-org', () => ({
  requireOrg: () => Promise.resolve(orgContext),
}));

const deleteDocumentCore = vi.fn<(...args: unknown[]) => Promise<ActionResult>>();
vi.mock('./core', () => ({
  deleteDocumentCore: (...args: unknown[]) => deleteDocumentCore(...args),
  getDocumentUrlCore: vi.fn(),
}));
vi.mock('./upload', () => ({ createDocumentUploadCore: vi.fn() }));

import { deleteClientDocument, deleteProjectDocument } from './actions';

const deleteActions = [
  ['deleteClientDocument', deleteClientDocument, 'client'],
  ['deleteProjectDocument', deleteProjectDocument, 'project'],
] as const;

beforeEach(() => {
  refreshApp.mockClear();
  deleteDocumentCore.mockReset();
});

describe.each(deleteActions)('%s', (_name, deleteDocument, entity) => {
  it('revalidates after a delete that committed', async () => {
    deleteDocumentCore.mockResolvedValue({ ok: true });
    await expect(deleteDocument('file-1')).resolves.toEqual({ ok: true });
    expect(refreshApp).toHaveBeenCalledTimes(1);
  });

  it('revalidates on `uncertain`, because the DELETE may well have committed', async () => {
    // mutateInOrg answers `uncertain` for a write deadline / lock timeout /
    // dropped socket. The row's fate is unknown, so the cache must NOT be kept.
    deleteDocumentCore.mockResolvedValue({ ok: false, error: 'uncertain' });
    await expect(deleteDocument('file-1')).resolves.toEqual({
      ok: false,
      error: 'uncertain',
    });
    expect(refreshApp).toHaveBeenCalledTimes(1);
  });

  it.each(['forbidden', 'invalid', 'generic'] as const)(
    'does not revalidate on `%s` — nothing was written',
    async (code) => {
      deleteDocumentCore.mockResolvedValue({ ok: false, error: code });
      await deleteDocument('file-1');
      expect(refreshApp).not.toHaveBeenCalled();
    },
  );

  it('delegates with the entity spec the action is named for', async () => {
    deleteDocumentCore.mockResolvedValue({ ok: true });
    await deleteDocument('file-1');
    expect(deleteDocumentCore).toHaveBeenCalledWith(
      orgContext,
      expect.objectContaining({ entity }),
      'file-1',
    );
  });
});
