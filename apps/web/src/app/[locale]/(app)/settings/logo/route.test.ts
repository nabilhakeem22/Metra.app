import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The studio's own logo for Settings: the signed-in member's ACTIVE org only,
// streamed as the stored original's bytes (never a redirect, never a storage
// URL), and every miss the same empty, uncached 404. The real reader
// (lib/org/own-logo.ts) runs: its query is built against a driverless drizzle so
// the SQL it would send can be read, and the rows it would get back are supplied
// here.

vi.mock('server-only', () => ({}));
const CTX = { orgId: 'org-own', userId: 'user-1', userEmail: 'a@b.c', role: 'viewer' } as const;
const auth = vi.hoisted(() => ({ requireOrg: vi.fn() }));
vi.mock('@/lib/auth/require-org', () => auth);
const database = vi.hoisted(() => ({ rows: [] as unknown[], contexts: [] as unknown[], queries: [] as unknown[] }));
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async (ctx: unknown, read: (tx: unknown) => { toSQL(): unknown }) => {
    database.contexts.push(ctx);
    database.queries.push(read(drizzle.mock()).toSQL());
    return database.rows;
  },
}));
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => storage);

const { GET } = await import('./route');

const OBJECT_KEY = 'org-own/organization/logo-1';
const OBJECT_SIGNED = `https://storage.test/object/sign/metra-files/${OBJECT_KEY}?token=O`;
const fetchMock = vi.fn();

function storedLogo(originalName: string | null) {
  database.rows = [{ bucket: 'metra-files', objectKey: OBJECT_KEY, originalName }];
}

async function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

beforeEach(() => {
  auth.requireOrg.mockReset().mockResolvedValue(CTX);
  database.contexts = [];
  database.queries = [];
  storedLogo('logo.webp');
  storage.createSignedObjectUrl.mockReset().mockResolvedValue(OBJECT_SIGNED);
  fetchMock.mockReset().mockResolvedValue(new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-type': 'image/webp' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the studio logo route', () => {
  it('streams the saved logo as its stored bytes, private, sniff-proof, with no URL in the answer', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('private, max-age=240');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 5, 6]);
    // The plain object URL, signed for 30 s, no transform: the stored original.
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 30);
    expect(fetchMock).toHaveBeenCalledWith(OBJECT_SIGNED, expect.objectContaining({ redirect: 'error' }));
  });

  it("reads only the caller's own org: its RLS context, its org row, a file of that same org", async () => {
    await GET();
    expect(database.contexts).toEqual([CTX]);
    const [query] = database.queries as Array<{ sql: string; params: unknown[] }>;
    expect(query!.sql).toContain('"files"."id" = "organizations"."logo_file_id"');
    expect(query!.sql).toContain('"files"."org_id" = "organizations"."id"');
    expect(query!.sql).toMatch(/where "organizations"\."id" = \$1/);
    expect(query!.params[0]).toBe('org-own');
  });

  it('no logo: the empty 404, and Storage is never asked', async () => {
    database.rows = [];
    await expectNotFound(await GET());
    expect(storage.createSignedObjectUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([['logo.svg'], ['brochure.pdf'], ['logo'], [null]])('a logo file named %j is not served: 404', async (name) => {
    storedLogo(name);
    await expectNotFound(await GET());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a fetch Storage refused, a non-image answer, an over-2 MB logo, or a throw: the same 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 400 }));
    await expectNotFound(await GET());
    fetchMock.mockResolvedValueOnce(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
    await expectNotFound(await GET());
    fetchMock.mockResolvedValueOnce(
      new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024 + 1) } }),
    );
    await expectNotFound(await GET());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.createSignedObjectUrl.mockRejectedValueOnce(new Error('storage down'));
    await expectNotFound(await GET());
    expect(log).toHaveBeenCalledWith('org logo failed');
  });

  it('signed out: the auth redirect propagates (it is not swallowed into a 404) and nothing is read', async () => {
    auth.requireOrg.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(GET()).rejects.toThrow('NEXT_REDIRECT');
    expect(database.queries).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
