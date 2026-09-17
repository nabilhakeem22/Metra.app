import 'server-only';
// Minting a signed upload for a document stapled to a client or a project.
//
// Deliberately NOT over `mutateInOrg`: this writes NO row. It returns a Storage
// URL, so a transaction with an audit entry would record an intent rather than a
// change — the file's row is written when the browser finishes the PUT.
import { eq } from 'drizzle-orm';
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
  type SignedUpload,
} from '@/lib/storage/uploads';
import type { DocumentEntitySpec } from './entities';

/**
 * Does the parent row load, in THIS org, under RLS?
 *
 * `files.entity_id` is polymorphic and carries NO foreign key, so this check is
 * the entire tenancy boundary between a forged id and a file stapled to another
 * firm's client.
 */
async function parentLoadsInOrg(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  parentId: string,
): Promise<boolean> {
  const [parent] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: spec.parentTable.id })
      .from(spec.parentTable)
      .where(eq(spec.parentTable.id, parentId))
      .limit(1),
  );
  return Boolean(parent);
}

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
  if (!(await parentLoadsInOrg(ctx, spec, input.parentId))) return err('invalid');

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
