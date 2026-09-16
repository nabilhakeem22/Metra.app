import 'server-only';
import { files } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
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
import type { DocumentEntitySpec } from './entities';

/**
 * A signed upload for a document stapled to `parentId`.
 *
 * Gated by the entity's WRITE capability (the broad activity/document audience).
 * The file is stamped `entity`/`entity_id` only after the parent row is proved to
 * load under RLS, because `files.entity_id` is polymorphic and carries no foreign
 * key — the core is the only thing standing between a forged id and a file
 * attached to another tenant's record.
 *
 * Deliberately NOT over `mutateInOrg`: this writes no row. It mints a Storage URL
 * and returns it, so a transaction with an audit entry would record an intent
 * rather than a change. The upload's row is written when the browser finishes.
 */
export async function createDocumentUploadCore(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  input: {
    parentId: string;
    contentType?: string;
    originalName?: string;
    /** The firm's filing category. Optional — a document can be filed later. */
    categoryId?: string | null;
  },
): Promise<SignedUpload | ActionResult> {
  if (!can(ctx.role, spec.writeCapability, 'create')) return err('forbidden');
  if (!isUuid(input.parentId)) return err('invalid');

  // The parent must be in this org (RLS-scoped) before we attach a file to it.
  const [parent] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: spec.parentTable.id })
      .from(spec.parentTable)
      .where(eq(spec.parentTable.id, input.parentId))
      .limit(1),
  );
  if (!parent) return err('invalid');

  // A category id is only trusted after it resolves IN THIS ORG under RLS — the
  // same-org FK is the DB backstop, but rejecting here returns a coded error
  // instead of a constraint violation.
  const categoryId = await resolveCategoryId(ctx, input.categoryId);
  if (categoryId === INVALID_CATEGORY) return err('invalid');

  await ensureFilesBucket();
  return createSignedUploadUrl(ctx, spec.entity, {
    contentType: input.contentType,
    originalName: input.originalName,
    entityId: input.parentId,
    categoryId,
  });
}

/**
 * A signed download URL for one document (org-scoped).
 *
 * The `files.entity` filter is the cross-ENTITY guard: a project file's id handed
 * to the client surface finds no row and is refused, so a client-document
 * endpoint can never mint a URL for an unrelated in-org file.
 */
export async function getDocumentUrlCore(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  if (!can(ctx.role, spec.readCapability, 'read')) return err('forbidden');
  const [owned] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entity, spec.entity)))
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

/**
 * Delete one document row. Same entity filter, and so the same cross-entity
 * refusal, as the URL mint above.
 *
 * Over `mutateInOrg` — the house spine — rather than a hand-rolled
 * `withOrgContext` + `recordAudit`: the capability is checked before the
 * transaction opens, a thrown `ActionError` becomes its coded failure, and an
 * ambiguous outcome (write deadline, lock timeout, dropped socket) surfaces as
 * `uncertain` instead of as a flat success. That last one is the reason: the
 * previous shape returned `{ ok: true }` from inside the callback, so a
 * connection dropped after the DELETE but before COMMIT would have been reported
 * to the studio as a deleted file that is still there.
 */
export async function deleteDocumentCore(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  fileId: string,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: spec.writeCapability, action: 'create' },
    async (tx, audit) => {
      const [owned] = await tx
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.entity, spec.entity)))
        .limit(1);
      if (!owned) fail('invalid');
      await tx.delete(files).where(eq(files.id, fileId));
      await audit({
        entity: 'file',
        entityId: fileId,
        action: 'delete',
        before: null,
        after: null,
      });
    },
  );
}
