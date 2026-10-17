'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { seedNewStudioCore, type MarketSeedSummary } from './seed-core';

/**
 * The new studio's market price book, fired by the onboarding wizard once
 * createOrg has answered, as a request of its own. No refresh: the wizard is
 * already navigating to the dashboard, and the router refreshes after a server
 * action a navigation overtook. Idempotent, so a repeat adds nothing.
 */
export async function seedNewStudioPriceBook(): Promise<ActionResult & { data?: MarketSeedSummary }> {
  return seedNewStudioCore(await requireOrg());
}
