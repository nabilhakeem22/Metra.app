import 'server-only';
import { organizations } from '@metra/db';
import { sql } from 'drizzle-orm';
import {
  withOrgContext,
  withUserContext,
  type OrgContext,
} from '@/lib/db/context';
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

/** A row from the current-user org list (for the workspace switcher). */
export interface UserOrgOption {
  orgId: string;
  role: string;
  nameAr: string | null;
  nameEn: string | null;
  accountId: string | null;
  accountNameAr: string | null;
  accountNameEn: string | null;
}

/** The orgs the current user belongs to (name-ordered) — org-switcher source. */
export async function listCurrentUserOrgs(
  userId: string,
): Promise<UserOrgOption[]> {
  return (await withUserContext(userId, (tx) =>
    tx.execute(
      sql`select org_id as "orgId", role, name_ar as "nameAr", name_en as "nameEn",
                 account_id as "accountId",
                 account_name_ar as "accountNameAr",
                 account_name_en as "accountNameEn"
          from public.app_current_user_orgs()
          order by name_en nulls last, name_ar nulls last`,
    ),
  )) as unknown as UserOrgOption[];
}

/** Whether the current user is a member of ANY org (onboarding redirect gate). */
export async function currentUserHasMembership(
  userId: string,
): Promise<boolean> {
  const rows = (await withUserContext(userId, (tx) =>
    tx.execute(
      sql`select org_id from public.app_current_user_memberships() limit 1`,
    ),
  )) as unknown as unknown[];
  return rows.length > 0;
}
