'use server';

import { getLocale } from 'next-intl/server';
import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { openBoqProposalCore } from './core/open';
import { sendProposalAsBoqCore } from './core/send';

/** Open (creating on first use) the delivery's BOQ working copy; returns its id. */
export async function openBoqProposal(
  engagementId: string,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await openBoqProposalCore(ctx, { engagementId });
  if (res.ok) refreshApp();
  return res;
}

/** Send the working copy to the client as the next BOQ version. */
export async function sendProposalAsBoq(
  proposalId: string,
): Promise<ActionResult & { data?: { documentNumber: string } }> {
  const ctx = await requireOrg();
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  const res = await sendProposalAsBoqCore(ctx, { proposalId, locale });
  if (res.ok) refreshApp();
  return res;
}
