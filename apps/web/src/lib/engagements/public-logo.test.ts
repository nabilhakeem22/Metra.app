import { afterEach, describe, expect, it, vi } from 'vitest';

// getDeliveryLogoByToken: every miss is the same null, and it never throws. The
// DB layer is an in-memory handle (the public-documents.test.ts pattern).
const dbState = vi.hoisted(() => ({ rows: [] as Array<{ data: unknown }>, throwOnCall: false, calls: 0 }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({
  withRequestDb: async () => {
    dbState.calls += 1;
    if (dbState.throwOnCall) throw new Error('db exploded with the hash in it');
    return dbState.rows;
  },
}));

const { getDeliveryLogoByToken } = await import('./public-logo');

function answer(data: unknown): void {
  dbState.throwOnCall = false;
  dbState.rows = [{ data }];
}

afterEach(() => {
  dbState.rows = [];
  dbState.calls = 0;
  vi.restoreAllMocks();
});

describe('getDeliveryLogoByToken', () => {
  it('returns the storage location the SDF resolved', async () => {
    answer({ bucket: 'metra-files', object_key: 'org-1/logo.png' });
    expect(await getDeliveryLogoByToken('raw-token')).toEqual({ bucket: 'metra-files', objectKey: 'org-1/logo.png' });
  });

  it('a blank token never reaches the database', async () => {
    expect(await getDeliveryLogoByToken('   ')).toBeNull();
    expect(dbState.calls).toBe(0);
  });

  it.each([[null], [{}], [{ bucket: '', object_key: 'k' }], [{ bucket: 'b', object_key: 7 }], ['nope']])(
    'a malformed answer %j is null',
    async (data) => {
      answer(data);
      expect(await getDeliveryLogoByToken('raw-token')).toBeNull();
    },
  );

  it('a database throw is null, logged without the error (it carries the hash)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbState.throwOnCall = true;
    expect(await getDeliveryLogoByToken('raw-token')).toBeNull();
    expect(log).toHaveBeenCalledWith('delivery logo read failed');
  });
});
