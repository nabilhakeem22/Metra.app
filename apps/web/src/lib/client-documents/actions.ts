'use server';

import { clients, files } from '@metra/db';
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
 * Signed upload for a client document. Gated by client_activity (the broad
 * activity/doc audience). The file is stamped entity='client', entity_id=clientId
 * (and confirmed the client is in-org first).
 */
export async function createClientDocumentUpload(input: {
  clientId: string;
  contentType?: string;
  originalName?: string;
  /** The firm's filing category. Optional — a document can be filed later. */
  categoryId?: string | null;
}): Promise<SignedUpload | ActionResult> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'client_activity', 'create')) return err('forbidden');
  if (!isUuid(input.clientId)) return err('invalid');

  // The client must be in this org (RLS-scoped) before we attach a file to it.
  const [client] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, input.clientId))
      .limit(1),
  );
  if (!client) return err('invalid');

  // A category id is only trusted after it resolves IN THIS ORG under RLS — the
  // same-org FK is the DB backstop, but rejecting here returns a coded error
  // instead of a constraint violation.
  const categoryId = await resolveCategoryId(ctx, input.categoryId);
  if (categoryId === INVALID_CATEGORY) return err('invalid');

  await ensureFilesBucket();
  return createSignedUploadUrl(ctx, 'client', {
    contentType: input.contentType,
    originalName: input.originalName,
    entityId: input.clientId,
    categoryId,
  });
}

/** A signed download URL for a client document (org-scoped). */
export async function getClientDocumentUrl(
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'clients', 'read')) return err('forbidden');
  // Only sign URLs for this org's CLIENT documents (mirrors the delete guard):
  // don't let a client-doc endpoint mint URLs for unrelated in-org files.
  const [owned] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entity, 'client')))
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

/** Delete a client document row (basic). Gated by client_activity. */
export async function deleteClientDocument(
  fileId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'client_activity', 'create')) return err('forbidden');
  return withOrgContext(ctx, async (tx) => {
    const [owned] = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entity, 'client')))
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
