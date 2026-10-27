import { beforeEach, describe, expect, it, vi } from 'vitest';

// S10 (go-live security): every internal download link is signed for 5 minutes.
// The option that let a caller pick another lifetime is gone, so the document
// and deliverable callers both get the same 300 s. The org lookup and the
// Storage client are replaced; the real getSignedUrl runs.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async () => [{ bucket: 'metra-files', objectKey: 'org-1/project/file-1' }],
}));
const storage = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: storage.createSignedUrl }) } }),
}));

const { getSignedUrl, INTERNAL_SIGNED_URL_TTL_SECONDS } = await import('./signed-urls');

const CTX = { orgId: 'org-1', userId: 'u1', userEmail: 'a@b.c', role: 'owner' } as const;

beforeEach(() => {
  storage.createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://storage.test/s' }, error: null });
});

describe('getSignedUrl', () => {
  it('signs for 300 seconds', async () => {
    expect(INTERNAL_SIGNED_URL_TTL_SECONDS).toBe(300);
    await getSignedUrl(CTX, 'file-1', { download: 'plan.pdf' });
    expect(storage.createSignedUrl).toHaveBeenCalledWith('org-1/project/file-1', 300, { download: 'plan.pdf' });
  });

  it('signs for 300 seconds without a download name too', async () => {
    await getSignedUrl(CTX, 'file-1');
    expect(storage.createSignedUrl).toHaveBeenCalledWith('org-1/project/file-1', 300, { download: undefined });
  });
});
