import type { Metadata } from 'next';

// Search Console / Bing Webmaster ownership tags, from public env vars only
// (never a hardcoded token). scripts/emit-static-pages.mjs holds the same regex
// for the "/" redirector page; src/test/verification-regex.test.ts keeps the
// two equal.

/** What a verification token may contain. Anything else could break out of the meta attribute. */
export const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{10,100}$/;

const GOOGLE_VARIABLE = 'NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION';
const BING_VARIABLE = 'NEXT_PUBLIC_BING_SITE_VERIFICATION';

/** The trimmed token, or undefined when blank. THROWS (fails the build) on a malformed one. */
function tokenFrom(variable: string, value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token) return undefined;
  if (!VERIFICATION_TOKEN.test(token)) {
    // developer-only: names the variable and the pattern, never the token value.
    throw new Error(`${variable} is not a valid site-verification token (expected ${VERIFICATION_TOKEN.source}).`);
  }
  return token;
}

/** Reads NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION / NEXT_PUBLIC_BING_SITE_VERIFICATION. Blank = absent; invalid = THROWS. */
export function siteVerification(): Metadata['verification'] | undefined {
  // Literal process.env reads, so Next inlines them into the build.
  const google = tokenFrom(GOOGLE_VARIABLE, process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION);
  const bing = tokenFrom(BING_VARIABLE, process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION);
  if (!google && !bing) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
  };
}
