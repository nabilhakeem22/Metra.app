'use server';

import { organizations } from '@metra/db';
import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { buildContractHtml } from '@/lib/pdf/contract-template';
import { can, canSeeMargin } from '@/lib/permissions/can';
import { eq } from 'drizzle-orm';
import {
  generateContractCore,
  issueContractCore,
  saveContractDraftCore,
  terminateContractCore,
  type SaveContractDraftInput,
} from './core';
import { getContractForPdf } from './queries';

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

export async function generateContract(
  proposalId: string,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await generateContractCore(ctx, { proposalId });
  if (res.ok) refreshApp();
  return res;
}

export async function saveContractDraft(
  input: SaveContractDraftInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await saveContractDraftCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

export async function issueContract(
  id: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  const res = await issueContractCore(ctx, { id });
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  const origin = await resolveOrigin();
  const link = `${origin}/${locale}/c/${res.data}`;
  refreshApp();
  return { ok: true, link };
}

export async function terminateContract(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await terminateContractCore(ctx, { id });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

/**
 * Renders the same HTML the PDF route uses, for an in-app preview. The internal
 * (cost) variant is margin-gated exactly like the route; the client variant strips
 * every cost figure. Never returns cost to a caller who cannot see margin.
 */
export async function getContractPreviewHtml(
  id: string,
  variant: 'client' | 'internal',
): Promise<ActionResult & { html?: string }> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'contracts_generate', 'read')) {
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
        .where(eq(organizations.id, ctx.orgId))
        .limit(1),
    );
    const seeMargin = canSeeMargin(ctx.role, org?.hide ?? true);
    if (variant === 'internal' && !seeMargin) {
      return { ok: false, error: 'forbidden' };
    }
    const detail = await getContractForPdf(ctx, id, variant === 'internal');
    if (!detail) return { ok: false, error: 'invalid' };

    const html = await buildContractHtml(detail, {
      locale: org?.defaultLocale ?? 'ar-EG',
      variant,
      orgNameAr: org?.nameAr ?? null,
      orgNameEn: org?.nameEn ?? null,
    });
    return { ok: true, html };
  } catch (err) {
    console.error('getContractPreviewHtml failed:', err);
    return { ok: false, error: 'generic' };
  }
}
