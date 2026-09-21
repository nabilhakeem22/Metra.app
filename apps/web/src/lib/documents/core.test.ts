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

// The Cloudflare execution context. Mocked rather than imported because
// `@opennextjs/cloudflare` is only loadable inside workerd — and because a fake
// `waitUntil` is the only way to observe that the abandoned removal was handed
// to the platform rather than dropped.
const onCloudflare = vi.fn<() => boolean>(() => false);
const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => onCloudflare(),
  cfExecutionContext: () => ({ waitUntil }),
}));

const getSignedUrl = vi.fn<(...args: unknown[]) => Promise<string>>();
const removeStoredObject = vi.fn<(...args: string[]) => Promise<void>>();
// TWO mocks, not one. The split moved these two functions into two leaves, and a
// single vi.mock on the old specifier would have mocked NOTHING while still
// looking correct.
vi.mock('@/lib/storage/signed-urls', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}));
vi.mock('@/lib/storage/objects', () => ({
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

import { STORAGE_CLEANUP_TIMEOUT_MS } from '@/lib/http/deadlines';
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
  // The real `removeStoredObject` returns a Promise; a fake that returns
  // undefined is a fake that lies about the contract, and the cleanup path now
  // attaches a `.catch` to what it gets back.
  removeStoredObject.mockResolvedValue(undefined);
  deletedRows.mockReset();
  auditEntries.length = 0;
  onCloudflare.mockReturnValue(false);
  waitUntil.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getDocumentUrlCore', () => {
  it('signs a URL for a file of this entity in this org', async () => {
    ownedRow.mockReturnValue({ id: 'file-1', originalName: 'Site survey.pdf' });
    getSignedUrl.mockResolvedValue('https://storage.example/signed');
    await expect(
      getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: true, url: 'https://storage.example/signed' });
  });

  it('signs as an ATTACHMENT, with the extension allowlist applied', async () => {
    // Served inline, an uploaded .html executes on the Supabase project origin.
    // A download name makes Storage answer Content-Disposition: attachment, and
    // the allowlist drops the extension so nothing can render it either way.
    ownedRow.mockReturnValue({ id: 'file-1', originalName: 'Invoice.html' });
    getSignedUrl.mockResolvedValue('https://storage.example/signed');
    await getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, 'file-1');
    expect(getSignedUrl).toHaveBeenCalledWith(ctx, 'file-1', { download: 'Invoice' });

    ownedRow.mockReturnValue({ id: 'file-1', originalName: 'Site survey v2.PDF' });
    await getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, 'file-1');
    expect(getSignedUrl).toHaveBeenLastCalledWith(ctx, 'file-1', {
      download: 'Site survey v2.pdf',
    });

    ownedRow.mockReturnValue({ id: 'file-1', originalName: null });
    await getDocumentUrlCore(ctx, DOCUMENT_ENTITIES.client, 'file-1');
    expect(getSignedUrl).toHaveBeenLastCalledWith(ctx, 'file-1', {
      download: 'document',
    });
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
    ownedRow.mockReturnValue({ id: 'file-1', originalName: 'plan.pdf' });
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

  it('does not hold the caller when Storage never answers at all', async () => {
    // The row is committed and gone; the bytes are best-effort. A Storage origin
    // that accepts the connection and never replies used to hold this action for
    // the upload client's 15 seconds — a studio clearing ten files waited 150.
    // STORAGE_CLEANUP_TIMEOUT_MS bounds the WAIT (not the work: a `remove` that
    // lands later is a success we did not observe, and the row is gone either
    // way), so the action still resolves `{ ok: true }` and says the removal
    // is STILL RUNNING — not that it failed, which nobody has observed.
    vi.useFakeTimers();
    try {
      deletedRows.mockReturnValue([storedObject]);
      removeStoredObject.mockReturnValue(new Promise<void>(() => {}));
      const answer = deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1');
      await vi.advanceTimersByTimeAsync(STORAGE_CLEANUP_TIMEOUT_MS + 1);
      await expect(answer).resolves.toEqual({ ok: true });
      expect(console.warn).toHaveBeenCalledWith(
        'document object remove still running past the cleanup deadline',
        // Redacted by `loggableFailure` (S2): the breadcrumb still names the
        // error, as its whitelisted shape rather than the object itself.
        expect.objectContaining({
          error: { name: 'HttpDeadlineError', message: expect.any(String) },
        }),
      );
      expect(console.error).not.toHaveBeenCalledWith(
        'document object remove failed',
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the removal to waitUntil on the Workers runtime, and still does not wait for it', async () => {
    // `withDeadline` bounds the WAIT, not the work — but on workerd "not
    // observed" means "killed": the isolate may be torn down the moment the
    // response is sent, and the object key is unreachable from the database
    // the instant the row is gone, so the orphan would be permanent.
    vi.useFakeTimers();
    try {
      onCloudflare.mockReturnValue(true);
      deletedRows.mockReturnValue([storedObject]);
      removeStoredObject.mockReturnValue(new Promise<void>(() => {}));
      const answer = deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1');
      await vi.advanceTimersByTimeAsync(STORAGE_CLEANUP_TIMEOUT_MS + 1);
      // The request stopped waiting at the deadline; the removal is STILL in
      // flight, and the platform is holding the isolate open for it.
      await expect(answer).resolves.toEqual({ ok: true });
      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defers nothing OFF-platform, where the await is the whole story', async () => {
    deletedRows.mockReturnValue([storedObject]);
    await expect(
      deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: true });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('survives an execution context that is not wired', async () => {
    // Some OpenNext render scopes have no ctx. Failing to DEFER best-effort
    // cleanup must never fail a delete that has already committed.
    onCloudflare.mockReturnValue(true);
    waitUntil.mockImplementation(() => {
      throw new Error('no execution context');
    });
    deletedRows.mockReturnValue([storedObject]);
    await expect(
      deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1'),
    ).resolves.toEqual({ ok: true });
    expect(removeStoredObject).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      'discardStoredBytes: waitUntil unavailable',
      { name: 'Error', message: 'no execution context' },
    );
  });

  it('logs a removal that fails AFTER the deadline, instead of leaving it unhandled', async () => {
    // The catch is attached to the removal, not to the race, so a Storage error
    // arriving once nobody is waiting still leaves a breadcrumb — and the
    // promise handed to waitUntil can never reject.
    vi.useFakeTimers();
    try {
      onCloudflare.mockReturnValue(true);
      deletedRows.mockReturnValue([storedObject]);
      let refuse: (error: Error) => void = () => {};
      removeStoredObject.mockReturnValue(
        new Promise<void>((_resolve, reject) => {
          refuse = reject;
        }),
      );
      const answer = deleteDocumentCore(ctx, DOCUMENT_ENTITIES.client, 'file-1');
      await vi.advanceTimersByTimeAsync(STORAGE_CLEANUP_TIMEOUT_MS + 1);
      await expect(answer).resolves.toEqual({ ok: true });
      refuse(new Error('storage 503 after the response'));
      await vi.advanceTimersByTimeAsync(1);
      expect(console.error).toHaveBeenCalledWith(
        'document object remove failed',
        expect.objectContaining({
          error: { name: 'Error', message: 'storage 503 after the response' },
        }),
      );
    } finally {
      vi.useRealTimers();
    }
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
