// PURE onboarding-metadata helpers (no server-only), so the read-merge-write
// logic is unit-testable. Onboarding state lives under `user_metadata.onboarding`
// — every write MUST preserve the rest of user_metadata AND the untouched
// onboarding sub-keys.

export interface OnboardingUserState {
  /** Per-USER (global): the guided tour has been auto-shown once. */
  tourSeen?: boolean;
  /** Resume anchor — the tour step id the user last saw. */
  tourStep?: string | null;
  tourCompletedAt?: string;
  /** Per-ORG: org ids whose getting-started checklist was dismissed. */
  dismissedOrgs?: string[];
}

type Metadata = Record<string, unknown>;

/** Extract the onboarding sub-object from a user's metadata (safe on garbage). */
export function readOnboarding(
  metadata: Metadata | null | undefined,
): OnboardingUserState {
  const raw = metadata?.onboarding;
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    tourSeen: typeof o.tourSeen === 'boolean' ? o.tourSeen : undefined,
    tourStep:
      typeof o.tourStep === 'string' || o.tourStep === null
        ? (o.tourStep as string | null)
        : undefined,
    tourCompletedAt:
      typeof o.tourCompletedAt === 'string' ? o.tourCompletedAt : undefined,
    dismissedOrgs: Array.isArray(o.dismissedOrgs)
      ? o.dismissedOrgs.filter((x): x is string => typeof x === 'string')
      : undefined,
  };
}

/**
 * Read-merge-write: return the FULL new metadata object with `patch` applied to
 * the onboarding sub-object. Other top-level keys and other onboarding sub-keys
 * are preserved verbatim.
 */
export function mergeOnboardingMetadata(
  metadata: Metadata | null | undefined,
  patch: Partial<OnboardingUserState>,
): Metadata {
  const current = readOnboarding(metadata);
  const nextOnboarding: OnboardingUserState = { ...current, ...patch };
  return { ...(metadata ?? {}), onboarding: nextOnboarding };
}

/** Add an org id to dismissedOrgs (deduped). Pure — for dismissChecklist. */
export function withDismissedOrg(
  state: OnboardingUserState,
  orgId: string,
): string[] {
  const set = new Set(state.dismissedOrgs ?? []);
  set.add(orgId);
  return [...set];
}
