import type { MetraDb } from '@metra/db';
import { recordAudit, type AuditEntry } from '@/lib/audit';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import type { Capability, PermissionAction } from '@/lib/permissions/roles';
import { ActionError, type ActionResult } from './result';

export { ActionError, fail } from './result';

/**
 * The sanctioned mutation wrapper. Optionally gates on a §2.2 capability BEFORE
 * opening a tx, then runs `fn` inside withOrgContext with an `audit` helper.
 * ActionError -> its coded failure; anything else -> logged + 'generic'.
 */
export async function mutateInOrg<T = void>(
  ctx: OrgContext,
  opts: { capability?: Capability; action?: PermissionAction },
  fn: (tx: MetraDb, audit: (e: AuditEntry) => Promise<void>) => Promise<T>,
): Promise<ActionResult & { data?: T }> {
  if (
    opts.capability &&
    !can(ctx.role, opts.capability, opts.action ?? 'update')
  ) {
    return { ok: false, error: 'forbidden' };
  }

  try {
    const data = await withOrgContext(ctx, (tx) =>
      fn(tx, (e) => recordAudit(tx, e)),
    );
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.code };
    console.error('mutateInOrg failed:', e);
    return { ok: false, error: 'generic' };
  }
}
