// `ensureFilesBucket` is awaited by every document upload, so what matters is
// how many times it asks Supabase — the answer it gets cannot change within a
// deployment. Supabase is replaced by counters; nothing here opens a socket.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getBucket = vi.fn<() => Promise<{ data: unknown }>>();
const createBucket = vi.fn<(name: string, options: unknown) => Promise<{ error: unknown }>>();
const updateBucket = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    storage: { getBucket, createBucket, updateBucket },
  }),
}));
vi.mock('@/lib/db/context', () => ({ withOrgContext: vi.fn() }));

/** A fresh module instance, because the memo it holds is module-scope state. */
async function freshStorage() {
  vi.resetModules();
  return import('./bucket');
}

beforeEach(() => {
  getBucket.mockReset();
  createBucket.mockReset();
  updateBucket.mockReset();
  getBucket.mockResolvedValue({ data: { name: 'metra-files', file_size_limit: 52428800 } });
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

describe('the files bucket size limit (S3)', () => {
  it('creates a missing bucket private, with the 50 MB limit', async () => {
    const { ensureFilesBucket } = await freshStorage();
    getBucket.mockResolvedValueOnce({ data: null });
    await ensureFilesBucket();
    expect(createBucket).toHaveBeenCalledWith('metra-files', { public: false, fileSizeLimit: 52428800 });
  });

  it('logs an existing bucket without a limit once, and never changes it', async () => {
    const { ensureFilesBucket } = await freshStorage();
    getBucket.mockResolvedValue({ data: { name: 'metra-files', file_size_limit: null } });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ensureFilesBucket();
    await ensureFilesBucket();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith('files bucket has no file size limit (runbook: docs/DEPLOY.md, storage limits)', { bucket: 'metra-files' });
    expect(updateBucket).not.toHaveBeenCalled();
    expect(createBucket).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('says nothing about a bucket that has its limit', async () => {
    const { ensureFilesBucket } = await freshStorage();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ensureFilesBucket();
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
