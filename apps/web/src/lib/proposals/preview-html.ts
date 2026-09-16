import 'server-only';
// Rendering the SAME html the PDF route renders, for the in-app preview iframe.
//
// NOT a server action: a `'use server'` module may export only async functions
// and every export becomes a callable RPC endpoint. This is the body behind one
// of them, so it lives beside `actions.ts` rather than inside it.
//
// MARGIN IS GATED TWICE HERE, deliberately. The `internal` variant is refused
// outright to a caller who may not see margin, AND `getProposalForPdf` is asked
// for the cost-blind document, so the client variant never LOADS a cost figure —
// there is nothing on the object for the template to leak.
import { organizations } from '@metra/db';
import type { ActionResult } from '@/lib/actions/result';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { buildProposalHtml } from '@/lib/pdf/proposal-template';
import { can, canSeeMargin } from '@/lib/permissions/can';
import { getProposalForPdf } from './queries';

/** The firm's branding and its margin policy, in one read. */
async function loadOrgBranding(ctx: OrgContext) {
  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        nameEn: organizations.nameEn,
        nameAr: organizations.nameAr,
        hide: organizations.hideMarginFromPm,
        defaultLocale: organizations.defaultLocale,
      })
      .from(organizations)
      .limit(1),
  );
  return org;
}

/**
 * The preview html, or a coded refusal. Never returns cost for a caller who
 * cannot see margin.
 */
export async function renderProposalPreviewHtml(
  ctx: OrgContext,
  id: string,
  variant: 'client' | 'internal',
): Promise<ActionResult & { html?: string }> {
  if (!can(ctx.role, 'proposals_build', 'read')) {
    return { ok: false, error: 'forbidden' };
  }
  try {
    const org = await loadOrgBranding(ctx);
    const seeMargin = canSeeMargin(ctx.role, org?.hide ?? true);
    if (variant === 'internal' && !seeMargin) {
      return { ok: false, error: 'forbidden' };
    }
    const detail = await getProposalForPdf(ctx, id, variant === 'internal');
    if (!detail) return { ok: false, error: 'invalid' };

    const html = await buildProposalHtml(detail, {
      locale: org?.defaultLocale ?? 'ar-EG',
      variant,
      orgNameAr: org?.nameAr ?? null,
      orgNameEn: org?.nameEn ?? null,
    });
    return { ok: true, html };
  } catch (err) {
    console.error('getProposalPreviewHtml failed:', err);
    return { ok: false, error: 'generic' };
  }
}
