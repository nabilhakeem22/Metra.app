// Where a sign-in lands (plan C3 "Post-login"). PURE and CLIENT-SAFE: the
// verify core asks it with the person's memberships, and the tests ask it
// without a database.
//
//   the site app's own login link (return=site), and
//   at least one internal membership                   -> /site
//   every internal membership is site_engineer         -> /site
//   any other membership                               -> /dashboard
//   no membership                                      -> /onboarding
//
// The two /site lines apply only while the site app is live (SITE_APP_LIVE).
// return=site with no internal membership (none at all, or a client one only)
// takes the normal path: the site app has no studio to show such a person.
// A probe that failed (memberships unknown) never blocks the sign-in: the
// dashboard, where requireOrg resolves the real destination.
import type { MemberRole } from '@/lib/permissions/roles';
import type { LoginReturn, PostLoginPath } from './otp-contract';

export interface LandingHints {
  returnTo?: LoginReturn;
  siteAppLive: boolean;
}

/** The person's internal memberships (a client membership is not internal). */
function internalRoles(memberRoles: readonly MemberRole[]): MemberRole[] {
  return memberRoles.filter((role) => role !== 'client');
}

/** Does the site app have a studio for this person, and is it where he lands? */
function landsOnSite(memberRoles: readonly MemberRole[], returnTo: LoginReturn | undefined): boolean {
  const internal = internalRoles(memberRoles);
  if (internal.length === 0) return false;
  return returnTo === 'site' || internal.every((role) => role === 'site_engineer');
}

/** The landing for these memberships; `null` when they could not be read. */
export function postLoginPathOf(memberRoles: readonly MemberRole[] | null, { returnTo, siteAppLive }: LandingHints): PostLoginPath {
  if (memberRoles === null) return '/dashboard';
  if (siteAppLive && landsOnSite(memberRoles, returnTo)) return '/site';
  return memberRoles.length > 0 ? '/dashboard' : '/onboarding';
}
