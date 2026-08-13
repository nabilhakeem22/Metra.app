'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  mergeOnboardingMetadata,
  readOnboarding,
  withDismissedOrg,
  type OnboardingUserState,
} from './merge';

// Read-merge-write against the FRESHEST metadata so we never clobber other keys.
async function patchOnboarding(
  patch: Partial<OnboardingUserState>,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const merged = mergeOnboardingMetadata(user.user_metadata, patch);
  await supabase.auth.updateUser({ data: merged });
}

/** The guided tour has been auto-shown (per user, global). */
export async function markTourSeen(step?: string | null): Promise<void> {
  await patchOnboarding({
    tourSeen: true,
    tourCompletedAt: new Date().toISOString(),
    ...(step !== undefined ? { tourStep: step } : {}),
  });
}

/** Persist the resume anchor as the user advances through the tour. */
export async function setTourStep(step: string | null): Promise<void> {
  await patchOnboarding({ tourStep: step });
}

/** Dismiss the getting-started checklist for ONE org (per-org). */
export async function dismissChecklist(orgId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const dismissedOrgs = withDismissedOrg(
    readOnboarding(user.user_metadata),
    orgId,
  );
  const merged = mergeOnboardingMetadata(user.user_metadata, { dismissedOrgs });
  await supabase.auth.updateUser({ data: merged });
}
