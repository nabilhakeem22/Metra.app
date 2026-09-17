// `ensureFilesBucket` is awaited by every document upload, so what matters is
// how many times it asks Supabase — the answer it gets cannot change within a
// deployment. Supabase is replaced by counters; nothing here opens a socket.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getBucket = vi.fn<() => Promise<{ data: unknown }>>();
const createBucket = vi.fn<() => Promise<{ error: unknown }>>();
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    storage: { getBucket, createBucket },
  }),
}));
vi.mock('@/lib/db/context', () => ({ withOrgContext: vi.fn() }));

/** A fresh module instance, because the memo it holds is module-scope state. */
async function freshStorage() {
  vi.resetModules();
  return import('./uploads');
}

beforeEach(() => {
  getBucket.mockReset();
  createBucket.mockReset();
  getBucket.mockResolvedValue({ data: { name: 'metra-files' } });
  createBucket.mockResolvedValue({ error: null });
});

describe('ensureFilesBucket', () => {
  it('asks Supabase ONCE, however many uploads await it', async () => {
    const { ensureFilesBucket } = await freshStorage();
    await ensureFilesBucket();
    await ensureFilesBucket();
    await ensureFilesBucket();
    expect(getBucket).toHaveBeenCalledTimes(1);
  });

  it('shares ONE round trip between callers that arrive together', async () => {
    // Memoised on the promise, not on a flag set after it settles: two uploads
    // in the same tick used to issue two identical requests.
    const { ensureFilesBucket } = await freshStorage();
    await Promise.all([ensureFilesBucket(), ensureFilesBucket()]);
    expect(getBucket).toHaveBeenCalledTimes(1);
  });

  it('creates the bucket when it is absent, then stops asking', async () => {
    const { ensureFilesBucket } = await freshStorage();
    getBucket.mockResolvedValueOnce({ data: null });
    await ensureFilesBucket();
    await ensureFilesBucket();
    expect(createBucket).toHaveBeenCalledTimes(1);
    expect(getBucket).toHaveBeenCalledTimes(1);
  });

  it('does not cache a FAILURE — an outage must not poison the isolate', async () => {
    const { ensureFilesBucket } = await freshStorage();
    getBucket.mockRejectedValueOnce(new Error('storage 503'));
    await expect(ensureFilesBucket()).rejects.toThrow('storage 503');
    await expect(ensureFilesBucket()).resolves.toBeUndefined();
    expect(getBucket).toHaveBeenCalledTimes(2);
  });

  it('tolerates the create losing a race with another isolate', async () => {
    // Two Workers isolates can both see no bucket; the loser's createBucket
    // answers "already exists", which is success, not a failure.
    const { ensureFilesBucket } = await freshStorage();
    getBucket.mockResolvedValueOnce({ data: null });
    createBucket.mockResolvedValueOnce({ error: { message: 'Bucket already exists' } });
    await expect(ensureFilesBucket()).resolves.toBeUndefined();
  });
});
