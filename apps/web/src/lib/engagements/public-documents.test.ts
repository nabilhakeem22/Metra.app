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

const { getDeliveryDocumentByToken, safeExtension } = await import(
  './public-documents'
);
const { ALLOWED_EXTENSIONS } = await import('./deliverable-files');

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
  };
}

afterEach(() => {
  dbState.throwOnCall = false;
  dbState.rows = [];
  dbState.calls = 0;
  vi.restoreAllMocks();
});

describe('safeExtension', () => {
  // The download allowlist is DERIVED from the upload allowlist so the two cannot
  // drift. This pins the resulting union, so widening the upload list to an active
  // type (svg, html, …) fails HERE and forces a deliberate decision instead of
  // silently reaching a client's browser.
  it('pins the derived allowlist to exactly the upload union', () => {
    const union = [...new Set(Object.values(ALLOWED_EXTENSIONS).flat())].sort();
    expect(union).toEqual(
      ['csv', 'dwg', 'dxf', 'jpeg', 'jpg', 'pdf', 'png', 'xlsx'].sort(),
    );
  });

  it('lowercases every ALLOWLISTED extension', () => {
    expect(safeExtension('drawing.PDF')).toBe('pdf');
    expect(safeExtension('a.b.c.xlsx')).toBe('xlsx');
    for (const extension of ['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'xlsx', 'csv']) {
      expect(safeExtension(`file.${extension}`)).toBe(extension);
      expect(safeExtension(`file.${extension.toUpperCase()}`)).toBe(extension);
    }
  });

  // S3: the `download=` param that would force an attachment is appended to the
  // signed URL AFTER signing, so it is NOT covered by the storage JWT and can be
  // stripped by whoever holds the link. A shape-only check let html/htm/svg through;
  // membership in the upload allowlist is the actual gate.
  it('REJECTS active-content extensions even though they pass the shape check', () => {
    for (const extension of ['html', 'htm', 'svg', 'xml', 'js', 'mjs', 'php']) {
      expect(safeExtension(`file.${extension}`)).toBeNull();
    }
  });

  it('rejects a well-shaped but non-allowlisted extension', () => {
    for (const name of ['x.abcde', 'x.zip', 'x.exe', 'x.docx', 'x.txt', 'x.a']) {
      expect(safeExtension(name)).toBeNull();
    }
  });

  it('still rejects header-injection shapes that merely contain an allowed word', () => {
    for (const name of [
      'file.pdf;x',
      'file.pdf"',
      'file.pdf\r\nX-Evil: 1',
      'file.pdf/../../etc',
      'file. pdf',
    ]) {
      expect(safeExtension(name)).toBeNull();
    }
  });

  it('returns null when there is nothing safe to use', () => {
    for (const name of [
      null,
      undefined,
      '',
      'noextension',
      'trailing.',
      '.hidden-has-ext-but-fine', // 'hidden-has-ext-but-fine' is not [a-z0-9]{1,5}
      'file.toolongext',
      'file.pd f',
      'file.pd/f',
      'file.pd"f',
      'file.رسم',
      'file.p\ndf',
    ]) {
      expect(safeExtension(name as string | null)).toBeNull();
    }
  });

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
    });
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
