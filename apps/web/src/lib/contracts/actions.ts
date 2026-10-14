'use server';

import { unexpectedFailure } from '@/lib/actions/unexpected';
import { getLocale } from 'next-intl/server';
import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import {
  generateContractCore,
  issueContractCore,
  saveContractDraftCore,
  terminateContractCore,
  type SaveContractDraftInput,
} from './core';

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
  if (!res.ok) return res;
  refreshApp();
  return { ok: true };
}

export async function issueContract(
  id: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  // Resolve the link origin BEFORE the state change: an origin we cannot
  // resolve must not leave behind a committed transition whose link the caller
  // never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return unexpectedFailure('issueContract: no request origin');
  const res = await issueContractCore(ctx, { id });
  if (!res.ok) return res;
  if (!res.data) return unexpectedFailure('issueContractCore answered ok without a token');
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  const link = `${origin}/${locale}/c/${res.data}`;
  refreshApp();
  return { ok: true, link };
}

export async function terminateContract(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await terminateContractCore(ctx, { id });
  if (!res.ok) return res;
  refreshApp();
  return { ok: true };
}
