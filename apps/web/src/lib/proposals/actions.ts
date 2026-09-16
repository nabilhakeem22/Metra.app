'use server';

// 'use server' wrappers ONLY: session work + delegate. No SQL here.
//
// Every export in this file is a callable RPC endpoint, so the two heavy bodies
// live beside it instead: ./send-email.ts (the best-effort client email) and
// ./preview-html.ts (the in-app preview render).

import { getLocale } from 'next-intl/server';
import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
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
import { renderProposalPreviewHtml } from './preview-html';
import { notifyClientOfSentProposal } from './send-email';

/** The reader's locale, or the product default. `getLocale()` throws outside a
 *  request scope, which a server action can be called from during a replay. */
async function currentLocale(): Promise<string> {
  try {
    return await getLocale();
  } catch {
    return 'ar-EG';
  }
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
  // Resolve the link origin BEFORE the state change: an origin we cannot
  // resolve must not leave behind a committed transition whose link the caller
  // never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return { ok: false, error: 'generic' };
  const res = await sendProposalCore(ctx, { id });
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };

  const locale = await currentLocale();
  const link = `${origin}/${locale}/p/${res.data}`;
  refreshApp();
  // The proposal is ALREADY sent. The email is best-effort and cannot fail this.
  const email = await notifyClientOfSentProposal(ctx, {
    proposalId: id,
    acceptUrl: link,
    locale,
  });
  return { ok: true, link, ...email };
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
  return renderProposalPreviewHtml(ctx, id, variant);
}

export async function deleteDraftProposal(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await deleteDraftProposalCore(ctx, { id });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}
