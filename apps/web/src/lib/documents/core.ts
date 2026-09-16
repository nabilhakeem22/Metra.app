import 'server-only';
// Reading and deleting a document that is already stored. The UPLOAD lives in
// ./upload.ts: it writes no row and therefore takes a different shape.
import { files, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { getSignedUrl } from '@/lib/storage';
import type { DocumentEntitySpec } from './entities';

/**
 * The file id, IF it exists in this org and belongs to THIS entity.
 *
 * The `files.entity` filter is the cross-ENTITY guard: a project file's id handed
 * to a client surface finds no row, so a client-document endpoint can never mint
 * a URL for — or delete — an unrelated in-org file. RLS is the cross-ORG half.
 */
async function ownedDocument(
  tx: MetraDb,
  spec: DocumentEntitySpec,
  fileId: string,
): Promise<{ id: string } | undefined> {
  const [owned] = await tx
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.entity, spec.entity)))
    .limit(1);
  return owned;
}

/**
 * A signed download URL for one document (org-scoped).
 *
 * Refused for a file of the wrong entity or another org — see `ownedDocument`.
 */
export async function getDocumentUrlCore(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  if (!can(ctx.role, spec.readCapability, 'read')) return err('forbidden');
  const owned = await withOrgContext(ctx, (tx) =>
    ownedDocument(tx, spec, fileId),
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
 * Delete one document row. Same `ownedDocument` lookup, and so the same
 * cross-entity and cross-org refusals, as the URL mint above.
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
      if (!(await ownedDocument(tx, spec, fileId))) fail('invalid');
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
