import type { Metadata } from 'next';
import { BING_VARIABLE, GOOGLE_VARIABLE, verificationToken } from '../../../scripts/site-verification-token.mjs';

// Search Console / Bing Webmaster ownership tags, from public env vars only
// (never a hardcoded token). The rule for a valid token is shared with
// next.config.mjs and scripts/emit-static-pages.mjs (scripts/site-verification-token.mjs).

/** Reads NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION / NEXT_PUBLIC_BING_SITE_VERIFICATION. Blank = absent; invalid = THROWS. */
export function siteVerification(): Metadata['verification'] | undefined {
  // Literal process.env reads, so Next inlines them into the build.
  const google = verificationToken(GOOGLE_VARIABLE, process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION);
  const bing = verificationToken(BING_VARIABLE, process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION);
  if (!google && !bing) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
  };
}
