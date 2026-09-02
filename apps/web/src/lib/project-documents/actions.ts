'use server';

import { files, projects } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { err, type ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';
import {
  INVALID_CATEGORY,
  resolveCategoryId,
} from '@/lib/document-categories/resolve';
import {
  createSignedUploadUrl,
  ensureFilesBucket,
  getSignedUrl,
  type SignedUpload,
} from '@/lib/storage';

/**
 * Signed upload for a project document. Gated by project_activity (the broad
 * activity/doc audience). The file is stamped entity='project', entity_id=
 * projectId (and confirmed the project is in-org first).
 */
export async function createProjectDocumentUpload(input: {
  projectId: string;
  contentType?: string;
  originalName?: string;
  /** The firm's filing category. Optional — a document can be filed later. */
  categoryId?: string | null;
}): Promise<SignedUpload | ActionResult> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'project_activity', 'create')) return err('forbidden');
  if (!isUuid(input.projectId)) return err('invalid');

  const [project] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1),
  );
  if (!project) return err('invalid');

  // Validated in-org and active, exactly as the client upload does.
  const categoryId = await resolveCategoryId(ctx, input.categoryId);
  if (categoryId === INVALID_CATEGORY) return err('invalid');

  await ensureFilesBucket();
  return createSignedUploadUrl(ctx, 'project', {
    contentType: input.contentType,
    originalName: input.originalName,
    entityId: input.projectId,
    categoryId,
  });
}

/** A signed download URL for a project document (org-scoped). */
export async function getProjectDocumentUrl(
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'projects', 'read')) return err('forbidden');
  const [owned] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entity, 'project')))
      .limit(1),
  );
  if (!owned) return err('invalid');
  try {
    const url = await getSignedUrl(ctx, fileId);
    return { ok: true, url };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

/** Delete a project document row (basic). Gated by project_activity. */
export async function deleteProjectDocument(
  fileId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'project_activity', 'create')) return err('forbidden');
  return withOrgContext(ctx, async (tx) => {
    const [owned] = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entity, 'project')))
      .limit(1);
    if (!owned) return { ok: false, error: 'invalid' };
    await tx.delete(files).where(eq(files.id, fileId));
    await recordAudit(tx, {
      entity: 'file',
      entityId: fileId,
      action: 'delete',
      before: null,
      after: null,
    });
    revalidatePath('/', 'layout');
    return { ok: true };
  });
}
