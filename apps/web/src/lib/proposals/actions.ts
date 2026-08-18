'use server';

import { organizations } from '@metra/db';
import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { sendProposalEmail } from '@/lib/email/resend';
import { formatMoney } from '@/lib/format/money';
import {
  formatProposalNumber,
  proposalYear,
} from '@/lib/format/proposal-number';
import { buildProposalHtml } from '@/lib/pdf/proposal-template';
import { can, canSeeMargin } from '@/lib/permissions/can';
import { eq } from 'drizzle-orm';
import {
  createProposalCore,
  deleteDraftProposalCore,
  expireProposalCore,
  saveProposalDraftCore,
  sendProposalCore,
  supersedeProposalCore,
  type CreateProposalInput,
  type SaveDraftInput,
} from './core';
import { getProposalForPdf, getProposalSendMeta } from './queries';

function refreshApp(): void {
  revalidatePath('/', 'layout');
}

async function resolveOrigin(): Promise<string> {
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (override) return override;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('cannot resolve request origin for share link');
  return `${proto}://${host}`;
}

export async function createProposal(
  input: CreateProposalInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await createProposalCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function saveProposalDraft(
  input: SaveDraftInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await saveProposalDraftCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function sendProposal(id: string): Promise<
  ActionResult & {
    link?: string;
    emailSent?: boolean;
    emailSkippedNoAddress?: boolean;
  }
> {
  const ctx = await requireOrg();
  const res = await sendProposalCore(ctx, { id });
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  const origin = await resolveOrigin();
  const link = `${origin}/${locale}/p/${res.data}`;
  refreshApp();

  // Best-effort client email. The proposal is ALREADY sent (core committed); a
  // meta-load or email failure must never roll that back or throw here.
  let emailSent = false;
  let emailSkippedNoAddress = false;
  try {
    const meta = await getProposalSendMeta(ctx, id);
    const clientEmail = meta?.clientEmail?.trim() || null;
    if (!clientEmail) {
      emailSkippedNoAddress = true;
    } else if (meta) {
      const [org] = await withOrgContext(ctx, (tx) =>
        tx
          .select({ nameEn: organizations.nameEn, nameAr: organizations.nameAr })
          .from(organizations)
          .where(eq(organizations.id, ctx.orgId))
          .limit(1),
      );
      const orgName =
        (locale.startsWith('ar')
          ? org?.nameAr || org?.nameEn
          : org?.nameEn || org?.nameAr) ?? 'Metra';
      const sent = await sendProposalEmail({
        to: clientEmail,
        orgName,
        proposalNumber: formatProposalNumber(
          meta.number,
          proposalYear(null, new Date()),
        ),
        totalDisplay: formatMoney(meta.total, locale),
        expiryDate: meta.expiryDate,
        acceptUrl: link,
        locale,
      });
      emailSent = sent.sent;
    }
  } catch (err) {
    console.error('sendProposal email step failed (send unaffected):', err);
  }

  return { ok: true, link, emailSent, emailSkippedNoAddress };
}

export async function expireProposal(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await expireProposalCore(ctx, { id });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function supersedeProposal(
  id: string,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await supersedeProposalCore(ctx, { id });
  if (res.ok) refreshApp();
  return res;
}

/**
 * Renders the same HTML the PDF route uses, for an in-app preview (iframe
 * srcDoc). The internal (cost) variant is margin-gated exactly like the route;
 * the client variant strips every cost figure. Never returns cost for a caller
 * who cannot see margin.
 */
export async function getProposalPreviewHtml(
  id: string,
  variant: 'client' | 'internal',
): Promise<ActionResult & { html?: string }> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) {
    return { ok: false, error: 'forbidden' };
  }
  try {
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

export async function deleteDraftProposal(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await deleteDraftProposalCore(ctx, { id });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}
