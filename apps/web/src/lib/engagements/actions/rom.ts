'use server';

// The build-cost band's two server actions. Split out of `lifecycle` because
// they are one concern and neither is a machine transition: `setEngagementRom`
// records the studio's working band, `issueRom` is the deliberate act of sending
// it to the client.

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { setEngagementRomCore, type SetEngagementRomInput } from '../rom';
import { issueRomCore } from '../rom-issue';

/**
 * Server-action wrapper for {@link setEngagementRomCore}: resolves the request's
 * org context, writes the coarse build-cost band (ROM low/high), and revalidates
 * the shell on success. Returns the ActionResult — never throws to the client.
 * This is plain data entry, NOT a machine transition: it moves no state. Any
 * edit un-issues the band, so the client stops seeing it until it is re-issued.
 */
export async function setEngagementRom(
  input: SetEngagementRomInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setEngagementRomCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for {@link issueRomCore}: resolves the request's org
 * context, stamps the band as issued to the client, and revalidates the shell on
 * success. Returns the ActionResult — never throws to the client. Owner/admin
 * only, because this is what puts a cost figure in front of the end client.
 */
export async function issueRom(engagementId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await issueRomCore(ctx, { engagementId });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
