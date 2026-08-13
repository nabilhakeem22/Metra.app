import 'server-only';
import { organizations } from '@metra/db';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { canSeeMargin } from '@/lib/permissions/can';

/**
 * Whether this caller may see cost/margin: the §2.2 `margin_pnl` grant AND the
 * org's `hide_margin_from_pm` toggle. Defaults to hidden (`?? true`) when the org
 * row is absent — identical to the sites this consolidates.
 */
export async function resolveSeeMargin(ctx: OrgContext): Promise<boolean> {
  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ hide: organizations.hideMarginFromPm })
      .from(organizations)
      .limit(1),
  );
  return canSeeMargin(ctx.role, org?.hide ?? true);
}
