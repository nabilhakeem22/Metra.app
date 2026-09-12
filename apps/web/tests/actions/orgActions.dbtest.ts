import { describe, expect, it, vi } from 'vitest';

// The createOrg ACTION wrapper (createOrg.dbtest.ts covers the core). Its
// session + cache dependencies are stubbed; the membership lookup and
// createOrgCore run for real against the test DB.
//
// A fresh uuid has no memberships, so the wrapper does NOT redirect to
// /dashboard and reaches the core — which is the branch under test.
vi.mock('@/lib/auth/session', () => {
  const userId = globalThis.crypto.randomUUID();
  return { getSessionUser: async () => ({ id: userId }) };
});
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// Import AFTER mocks are registered.
const { createOrg } = await import('@/lib/org/actions');

describe('createOrg (action wrapper)', () => {
  it('RESOLVES to a coded ActionResult for a nameless org — it never rejects', async () => {
    // The old wrapper threw the code, which reaches the browser as an opaque
    // Next.js digest the wizard cannot localize.
    await expect(
      createOrg({ nameEn: null, nameAr: null, firmType: 'interior' }),
    ).resolves.toEqual({ ok: false, error: 'name_required' });
  });
});
