import { drizzle } from 'drizzle-orm/postgres-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// S3: the logo is checked on the server twice: what the browser declares before
// an upload URL is signed, and what Storage holds before the logo is attached.

const deps = vi.hoisted(() => ({
  requireOrg: vi.fn(),
  withOrgContext: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  ensureFilesBucket: vi.fn(),
  storedObjectInfo: vi.fn(),
  removeStoredObject: vi.fn(),
  recordAudit: vi.fn(),
}));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: deps.requireOrg }));
vi.mock('@/lib/db/context', () => ({ withOrgContext: deps.withOrgContext }));
vi.mock('@/lib/storage/uploads', () => ({ createSignedUploadUrl: deps.createSignedUploadUrl }));
vi.mock('@/lib/storage/bucket', () => ({ ensureFilesBucket: deps.ensureFilesBucket }));
vi.mock('@/lib/storage/object-info', () => ({ storedObjectInfo: deps.storedObjectInfo }));
vi.mock('@/lib/storage/objects', () => ({ removeStoredObject: deps.removeStoredObject }));
vi.mock('@/lib/audit', () => ({ recordAudit: deps.recordAudit }));

const { createLogoUpload, setOrgLogo } = await import('./logo-actions');

const FILE = { bucket: 'metra-files', objectKey: 'org-1/org-logo/f-1', originalName: 'logo.png' };

type FileLookup = (tx: unknown) => { toSQL(): { sql: string; params: unknown[] } };

/**
 * The files table as RLS shows it to this org, holding one file: it answers the
 * lookup's own SQL (built against a driverless drizzle), so a row comes back only
 * when the query's id AND entity both match that file.
 */
function orgHoldsOnly(file: { id: string; entity: string }, secondAnswer: unknown = { ok: true }) {
  deps.withOrgContext.mockReset().mockImplementationOnce(async (_ctx: unknown, lookup: FileLookup) => {
    const { sql, params } = lookup(drizzle.mock()).toSQL();
    expect(sql).toContain('where ("files"."id" = $1 and "files"."entity" = $2)');
    return file.id === params[0] && file.entity === params[1] ? [FILE] : [];
  });
  deps.withOrgContext.mockResolvedValueOnce(secondAnswer);
}

/** What the org row answers when a refusal asks which file the logo points at now. */
const orgUsesLogo = (logoFileId: string | null) => [{ logoFileId }];

/** The two reads of a refused upload: the upload lookup, then the logo in use. */
function uploadFoundWhileOrgUses(logoFileId: string | null) {
  deps.withOrgContext.mockReset().mockResolvedValueOnce([FILE]).mockResolvedValueOnce(orgUsesLogo(logoFileId));
}

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.requireOrg.mockResolvedValue({ orgId: 'org-1', userId: 'u-1', role: 'owner' });
  deps.createSignedUploadUrl.mockResolvedValue({ fileId: 'f-1', objectKey: FILE.objectKey, signedUrl: 'u', token: 't' });
  deps.removeStoredObject.mockResolvedValue(undefined);
  // First call: the RLS-scoped file lookup. Second: the attach transaction.
  deps.withOrgContext.mockResolvedValueOnce([FILE]).mockResolvedValueOnce({ ok: true });
});

describe('createLogoUpload', () => {
  it('signs a PNG under 2 MB', async () => {
    expect(await createLogoUpload({ contentType: 'image/png', originalName: 'logo.png', size: 5000 })).toMatchObject({ fileId: 'f-1' });
  });

  it.each([
    [{ contentType: 'image/svg+xml', originalName: 'logo.svg', size: 10 }, 'logo_image_unsupported'],
    [{ contentType: 'text/html', originalName: 'logo.png', size: 10 }, 'logo_image_unsupported'],
    [{ contentType: 'image/png', originalName: 'logo.png', size: 3 * 1024 * 1024 }, 'file_too_large'],
  ])('refuses %j before signing anything', async (input, error) => {
    expect(await createLogoUpload(input)).toEqual({ ok: false, error });
    expect(deps.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('setOrgLogo', () => {
  it('attaches a stored PNG under 2 MB', async () => {
    deps.storedObjectInfo.mockResolvedValue({ contentType: 'image/png', size: 5000 });
    expect(await setOrgLogo('f-1')).toEqual({ ok: true });
    expect(deps.removeStoredObject).not.toHaveBeenCalled();
  });

  it.each([
    ['stored as SVG under a PNG name', { contentType: 'image/svg+xml', size: 10 }, 'logo_image_unsupported'],
    ['over 2 MB whatever was declared', { contentType: 'image/png', size: 5 * 1024 * 1024 }, 'file_too_large'],
  ])('refuses a logo %s, removes it, and does not attach it', async (_label, stored, error) => {
    uploadFoundWhileOrgUses('f-other');
    deps.storedObjectInfo.mockResolvedValue(stored);
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error });
    expect(deps.removeStoredObject).toHaveBeenCalledWith(FILE.bucket, FILE.objectKey);
    // The upload lookup and the logo in use. Never the attach transaction.
    expect(deps.withOrgContext).toHaveBeenCalledTimes(2);
  });

  it('refuses a logo that Storage cannot describe and removes nothing: an outage is not a verdict on the file', async () => {
    deps.storedObjectInfo.mockResolvedValue(null);
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error: 'storage_unavailable' });
    expect(deps.removeStoredObject).not.toHaveBeenCalled();
    expect(deps.withOrgContext).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['stored as SVG under a PNG name', { contentType: 'image/svg+xml', size: 10 }, 'logo_image_unsupported'],
    ['over 2 MB whatever was declared', { contentType: 'image/png', size: 5 * 1024 * 1024 }, 'file_too_large'],
  ])('refuses the logo already in use when it is %s, and keeps its bytes', async (_label, stored, error) => {
    uploadFoundWhileOrgUses('f-1');
    deps.storedObjectInfo.mockResolvedValue(stored);
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error });
    expect(deps.removeStoredObject).not.toHaveBeenCalled();
    expect(deps.withOrgContext).toHaveBeenCalledTimes(2);
  });

  it('removes a refused upload when the org has no logo yet', async () => {
    uploadFoundWhileOrgUses(null);
    deps.storedObjectInfo.mockResolvedValue({ contentType: 'image/svg+xml', size: 10 });
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error: 'logo_image_unsupported' });
    expect(deps.removeStoredObject).toHaveBeenCalledWith(FILE.bucket, FILE.objectKey);
  });

  it('a file that is not in this workspace is not found, and nothing is removed', async () => {
    deps.withOrgContext.mockReset().mockResolvedValueOnce([]);
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error: 'record_not_found' });
    expect(deps.removeStoredObject).not.toHaveBeenCalled();
  });

  it.each([['engagement'], ['client'], ['project']])(
    'a file of this workspace filed under %j is not a logo upload: not found, never inspected, never removed',
    async (entity) => {
      orgHoldsOnly({ id: 'f-1', entity });
      expect(await setOrgLogo('f-1')).toEqual({ ok: false, error: 'record_not_found' });
      expect(deps.storedObjectInfo).not.toHaveBeenCalled();
      expect(deps.removeStoredObject).not.toHaveBeenCalled();
      expect(deps.withOrgContext).toHaveBeenCalledTimes(1);
    },
  );

  it('a real logo upload is still found by that lookup: attached when it passes the rule', async () => {
    orgHoldsOnly({ id: 'f-1', entity: 'org-logo' });
    deps.storedObjectInfo.mockResolvedValue({ contentType: 'image/png', size: 5000 });
    expect(await setOrgLogo('f-1')).toEqual({ ok: true });
    expect(deps.removeStoredObject).not.toHaveBeenCalled();
  });

  it('a real logo upload that fails the rule is still refused and removed', async () => {
    orgHoldsOnly({ id: 'f-1', entity: 'org-logo' }, orgUsesLogo('f-other'));
    deps.storedObjectInfo.mockResolvedValue({ contentType: 'image/svg+xml', size: 10 });
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error: 'logo_image_unsupported' });
    expect(deps.removeStoredObject).toHaveBeenCalledWith(FILE.bucket, FILE.objectKey);
  });

  it('a viewer is refused before anything is read', async () => {
    deps.requireOrg.mockResolvedValue({ orgId: 'org-1', userId: 'u-1', role: 'viewer' });
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.withOrgContext).not.toHaveBeenCalled();
  });
});
