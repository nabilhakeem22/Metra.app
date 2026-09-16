import { afterEach, describe, expect, it, vi } from 'vitest';

// getDeliveryDocumentByToken is server-only and runs the token SDF over
// withRequestDb. Stub `server-only` and replace the DB layer with an in-memory
// handle so the guard rails (uuid pre-check, malformed snapshots, throws) can be
// exercised with NO real socket — the same pattern as public.test.ts.
const dbState = vi.hoisted(() => ({
  rows: [] as Array<{ data: unknown }>,
  throwOnCall: false,
  calls: 0,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  withRequestDb: async () => {
    dbState.calls += 1;
    if (dbState.throwOnCall) throw new Error('db exploded');
    return dbState.rows;
  },
}));

const { getDeliveryDocumentByToken } = await import('./public-documents');

const DOCUMENT_ID = '11111111-2222-4333-8444-555555555555';

function setSnapshot(snapshot: unknown): void {
  dbState.throwOnCall = false;
  dbState.rows = [{ data: snapshot }];
}

function validSnapshot(): Record<string, unknown> {
  return {
    bucket: 'metra-files',
    object_key: 'org-1/engagement/file-1',
    kind: 'approved_render',
    original_name: 'Villa render FINAL.PNG',
    access: 'download',
  };
}

afterEach(() => {
  dbState.throwOnCall = false;
  dbState.rows = [];
  dbState.calls = 0;
  vi.restoreAllMocks();
});

describe('getDeliveryDocumentByToken', () => {
  it('maps a valid snapshot to a bucket/key plus a category download name', async () => {
    setSnapshot(validSnapshot());
    await expect(
      getDeliveryDocumentByToken('raw-token', DOCUMENT_ID),
    ).resolves.toEqual({
      bucket: 'metra-files',
      objectKey: 'org-1/engagement/file-1',
      downloadName: '3d-visual.png',
      access: 'download',
    });
  });

  it('parses the access verdict, defaulting an unknown one to `withheld`', async () => {
    // The route enforces on this value, so an unrecognised verdict must NEVER
    // widen into a download — the fail-closed direction is the whole point.
    for (const [given, expected] of [
      ['download', 'download'],
      ['preview', 'preview'],
      ['withheld', 'withheld'],
      ['anything-else', 'withheld'],
      [undefined, 'withheld'],
    ] as const) {
      setSnapshot({ ...validSnapshot(), access: given });
      const result = await getDeliveryDocumentByToken('raw-token', DOCUMENT_ID);
      expect(result?.access).toBe(expected);
    }
  });

  it('omits the extension when the stored name has none it can trust', async () => {
    setSnapshot({ ...validSnapshot(), original_name: null });
    const result = await getDeliveryDocumentByToken('raw-token', DOCUMENT_ID);
    expect(result?.downloadName).toBe('3d-visual');
  });

  it('never leaks the studio filename into the download name', async () => {
    setSnapshot({
      ...validSnapshot(),
      original_name: 'INTERNAL rates - do not send.pdf',
    });
    const result = await getDeliveryDocumentByToken('raw-token', DOCUMENT_ID);
    expect(result?.downloadName).toBe('3d-visual.pdf');
  });

  it('rejects a non-uuid document id BEFORE any DB call', async () => {
    dbState.throwOnCall = true; // would throw if reached
    for (const id of [
      '',
      'not-a-uuid',
      '11111111-2222-4333-8444-55555555555',
      "' or 1=1 --",
      `${DOCUMENT_ID} `,
    ]) {
      await expect(getDeliveryDocumentByToken('raw-token', id)).resolves.toBeNull();
    }
    expect(dbState.calls).toBe(0);
  });

  it('returns null for an empty token without touching the DB', async () => {
    dbState.throwOnCall = true;
    await expect(getDeliveryDocumentByToken('   ', DOCUMENT_ID)).resolves.toBeNull();
    expect(dbState.calls).toBe(0);
  });

  it('returns null when the SDF resolves nothing (miss is indistinguishable)', async () => {
    setSnapshot(null);
    await expect(
      getDeliveryDocumentByToken('raw-token', DOCUMENT_ID),
    ).resolves.toBeNull();
  });

  it('returns null (no throw) when the DB call throws, logging no token', async () => {
    dbState.throwOnCall = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      getDeliveryDocumentByToken('raw-token', DOCUMENT_ID),
    ).resolves.toBeNull();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('raw-token');
    expect(logged).not.toContain(DOCUMENT_ID);
  });

  it('never throws across a battery of malformed snapshots', async () => {
    const hostile: unknown[] = [
      undefined,
      42,
      'string',
      [],
      {},
      { bucket: 'metra-files' },
      { bucket: '', object_key: 'k', kind: 'boq' },
      { bucket: 'b', object_key: '', kind: 'boq' },
      { bucket: 'b', object_key: 'k', kind: 'not_a_kind' },
      { bucket: 'b', object_key: 'k' },
      { bucket: 5, object_key: 6, kind: 7, original_name: 8 },
    ];
    for (const snapshot of hostile) {
      setSnapshot(snapshot);
      await expect(
        getDeliveryDocumentByToken('raw-token', DOCUMENT_ID),
      ).resolves.toBeNull();
    }
  });
});
