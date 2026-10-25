// Where a sign-in lands (plan C3 "Post-login"). PURE and CLIENT-SAFE: the
// verify core asks it with the person's memberships, and the tests ask it
// without a database.
//
//   the site app's own login link (return=site)        -> /site
//   every internal membership is site_engineer         -> /site
//   any other membership                               -> /dashboard
//   no membership                                      -> /onboarding
//
// The two /site lines apply only while the site app is live (SITE_APP_LIVE).
// A probe that failed (memberships unknown) never blocks the sign-in: the
// dashboard, where requireOrg resolves the real destination.
import type { MemberRole } from '@/lib/permissions/roles';
import type { LoginReturn, PostLoginPath } from './otp-contract';

export interface LandingHints {
  returnTo?: LoginReturn;
  siteAppLive: boolean;
}

/** True when the person's every internal membership is site engineer (a client membership is not internal). */
function worksOnlyOnSite(memberRoles: readonly MemberRole[]): boolean {
  const internal = memberRoles.filter((role) => role !== 'client');
  return internal.length > 0 && internal.every((role) => role === 'site_engineer');
}

/** The landing for these memberships; `null` when they could not be read. */
export function postLoginPathOf(memberRoles: readonly MemberRole[] | null, { returnTo, siteAppLive }: LandingHints): PostLoginPath {
  if (siteAppLive && returnTo === 'site') return '/site';
  if (memberRoles === null) return '/dashboard';
  if (siteAppLive && worksOnlyOnSite(memberRoles)) return '/site';
  return memberRoles.length > 0 ? '/dashboard' : '/onboarding';
}
