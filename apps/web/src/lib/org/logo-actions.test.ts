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
    [{ contentType: 'image/svg+xml', originalName: 'logo.svg', size: 10 }, 'invalid'],
    [{ contentType: 'text/html', originalName: 'logo.png', size: 10 }, 'invalid'],
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
    ['stored as SVG under a PNG name', { contentType: 'image/svg+xml', size: 10 }, 'invalid'],
    ['over 2 MB whatever was declared', { contentType: 'image/png', size: 5 * 1024 * 1024 }, 'file_too_large'],
    ['that Storage cannot describe', null, 'invalid'],
  ])('refuses a logo %s, removes it, and does not attach it', async (_label, stored, error) => {
    deps.storedObjectInfo.mockResolvedValue(stored);
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error });
    expect(deps.removeStoredObject).toHaveBeenCalledWith(FILE.bucket, FILE.objectKey);
    expect(deps.withOrgContext).toHaveBeenCalledTimes(1);
  });

  it('a viewer is refused before anything is read', async () => {
    deps.requireOrg.mockResolvedValue({ orgId: 'org-1', userId: 'u-1', role: 'viewer' });
    expect(await setOrgLogo('f-1')).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.withOrgContext).not.toHaveBeenCalled();
  });
});
