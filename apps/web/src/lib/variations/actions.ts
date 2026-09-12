'use server';

import { getLocale } from 'next-intl/server';
import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import {
  createVariationDraftCore,
  internalApproveVariationCore,
  issueVariationCore,
  saveVariationDraftCore,
  type CreateVariationDraftInput,
  type SaveVariationDraftInput,
} from './core';

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
  // Resolve the link origin BEFORE the state change: an origin we cannot
  // resolve must not leave behind a committed transition whose link the caller
  // never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return { ok: false, error: 'generic' };
  const res = await internalApproveVariationCore(ctx, { id });
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
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
