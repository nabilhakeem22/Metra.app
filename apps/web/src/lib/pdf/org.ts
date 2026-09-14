import 'server-only';
// The org row a PDF header needs, and the one rule about missing it.
import { organizations } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** The org fields every document header needs. */
export interface PdfOrg {
  nameAr: string | null;
  nameEn: string | null;
  defaultLocale: string;
  hideMarginFromPm: boolean;
}

/**
 * What a PDF assumes when the org row is not there. Losing branding is
 * survivable; defaulting `hideMarginFromPm` the other way would hand the firm's
 * cost to a role the org may have meant to blind.
 */
export const MARGIN_HIDING_ORG: PdfOrg = {
  nameAr: null,
  nameEn: null,
  defaultLocale: 'ar-EG',
  hideMarginFromPm: true,
};

/**
 * The caller's own org row. Explicitly `where id = ctx.orgId` rather than
 * `limit 1` inside the RLS transaction: the policy already scopes it, but a bare
 * `limit 1` is a query whose correctness depends entirely on something a reader
 * cannot see here, and it would silently pick an arbitrary row if the policy
 * ever widened.
 */
export async function loadPdfOrg(ctx: OrgContext): Promise<PdfOrg> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        nameAr: organizations.nameAr,
        nameEn: organizations.nameEn,
        defaultLocale: organizations.defaultLocale,
        hideMarginFromPm: organizations.hideMarginFromPm,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1),
  );
  return row ?? MARGIN_HIDING_ORG;
}
