'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
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

export async function sendProposal(
  id: string,
): Promise<ActionResult & { link?: string }> {
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
  refreshApp();
  return { ok: true, link: `${origin}/${locale}/p/${res.data}` };
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

export async function deleteDraftProposal(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await deleteDraftProposalCore(ctx, { id });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}
