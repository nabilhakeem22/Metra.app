'use server';

import { files, organizations } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { err, type ActionResult } from '@/lib/actions/result';
import { recordAudit } from '@/lib/audit';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { canManageOrg } from '@/lib/permissions/can';
import { ensureFilesBucket } from '@/lib/storage/bucket';
import { storedObjectInfo } from '@/lib/storage/object-info';
import { removeStoredObject } from '@/lib/storage/objects';
import { createSignedUploadUrl, type SignedUpload } from '@/lib/storage/uploads';
import { logoRefusal } from './logo-rules';

/** The `files.entity` a logo upload is registered under, and the only one `setOrgLogo` reads. */
const LOGO_UPLOAD_ENTITY = 'org-logo';

/**
 * Signed upload URL for the org logo (org must already exist). Manage-only. The
 * declared name, type and size must be a PNG, JPG or WebP of at most 2 MB
 * (./logo-rules.ts) before anything is signed.
 */
export async function createLogoUpload(input: {
  contentType?: string;
  originalName?: string;
  size?: number;
}): Promise<SignedUpload | ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  const refusal = logoRefusal(input);
  if (refusal) return err(refusal);
  await ensureFilesBucket();
  return createSignedUploadUrl(ctx, LOGO_UPLOAD_ENTITY, {
    contentType: input.contentType,
    originalName: input.originalName,
  });
}

/**
 * The caller's own logo upload, or nothing. RLS scopes the read to the org; the
 * entity scopes it to logo uploads, so no other file of the org (an issued PDF,
 * a signed scan, a held-back render) can be attached as the logo or removed by
 * the refusal in `setOrgLogo`.
 */
async function findLogoUpload(ctx: OrgContext, fileId: string) {
  const [logoUpload] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ bucket: files.bucket, objectKey: files.objectKey, originalName: files.originalName })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entity, LOGO_UPLOAD_ENTITY)))
      .limit(1),
  );
  return logoUpload;
}

/**
 * Points the org at an uploaded logo file — only if the file is a logo upload in
 * the org AND what Storage actually holds passes the same rule (the declared type
 * and size are only the uploader's word). A refused upload is removed, best effort.
 */
export async function setOrgLogo(fileId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  const owned = await findLogoUpload(ctx, fileId);
  if (!owned) return err('record_not_found');

  // Storage that cannot describe the object is the restrictive answer: refused.
  const stored = await storedObjectInfo(owned.bucket, owned.objectKey);
  const refusal = stored
    ? logoRefusal({ originalName: owned.originalName, contentType: stored.contentType, size: stored.size ?? 0 })
    : 'storage_unavailable';
  if (refusal) {
    await removeStoredObject(owned.bucket, owned.objectKey).catch(() => undefined);
    return err(refusal);
  }

  return withOrgContext(ctx, async (tx) => {
    await tx
      .update(organizations)
      .set({ logoFileId: fileId, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.orgId));
    await recordAudit(tx, {
      entity: 'organization',
      entityId: ctx.orgId,
      action: 'update',
      before: null,
      after: { logo_file_id: fileId },
    });
    return { ok: true };
  });
}
