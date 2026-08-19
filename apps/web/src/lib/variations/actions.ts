'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  createVariationDraftCore,
  internalApproveVariationCore,
  issueVariationCore,
  saveVariationDraftCore,
  type CreateVariationDraftInput,
  type SaveVariationDraftInput,
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

async function localeSafe(): Promise<string> {
  try {
    return await getLocale();
  } catch {
    return 'ar-EG';
  }
}

export async function createVariationDraft(
  input: CreateVariationDraftInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await createVariationDraftCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function saveVariationDraft(
  input: SaveVariationDraftInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await saveVariationDraftCore(ctx, input);
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}

/**
 * Internal approval (owner/admin). Mints — but does not yet activate — the client
 * decision token, and returns the `/v/[token]` link so the manager can issue it.
 * The link only works once the VO is issued (the SDF hides non-issued VOs).
 */
export async function internalApproveVariation(
  id: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  const res = await internalApproveVariationCore(ctx, { id });
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  const origin = await resolveOrigin();
  const link = `${origin}/${await localeSafe()}/v/${res.data}`;
  refreshApp();
  return { ok: true, link };
}

export async function issueVariation(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await issueVariationCore(ctx, { id });
  if (res.ok) refreshApp();
  return { ok: res.ok, error: res.error };
}
