'use server';

import { files, organizations } from '@metra/db';
import { eq } from 'drizzle-orm';
import { err, type ActionResult } from '@/lib/actions/result';
import { recordAudit } from '@/lib/audit';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { canManageOrg } from '@/lib/permissions/can';
import { ensureFilesBucket } from '@/lib/storage/bucket';
import { storedObjectInfo } from '@/lib/storage/object-info';
import { removeStoredObject } from '@/lib/storage/objects';
import { createSignedUploadUrl, type SignedUpload } from '@/lib/storage/uploads';
import { logoRefusal } from './logo-rules';

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
  return createSignedUploadUrl(ctx, 'org-logo', {
    contentType: input.contentType,
    originalName: input.originalName,
  });
}

/**
 * Points the org at an uploaded logo file — only if the file is in the org AND
 * what Storage actually holds passes the same rule (the declared type and size
 * are only the uploader's word). A refused upload is removed, best effort.
 */
export async function setOrgLogo(fileId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  // Confirm the file belongs to the caller's org (RLS-scoped). Reject otherwise.
  const [owned] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ bucket: files.bucket, objectKey: files.objectKey, originalName: files.originalName })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1),
  );
  if (!owned) return err('invalid');

  const stored = await storedObjectInfo(owned.bucket, owned.objectKey);
  const refusal = stored
    ? logoRefusal({ originalName: owned.originalName, contentType: stored.contentType, size: stored.size ?? 0 })
    : 'invalid';
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
