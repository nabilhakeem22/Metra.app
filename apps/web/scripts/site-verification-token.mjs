/**
 * The one rule for the Search Console / Bing ownership tokens. Plain .mjs so
 * all three readers can import it: next.config.mjs (fails the build with a
 * message Next prints in full), src/lib/seo/site-verification.ts (the landing
 * metadata) and scripts/emit-static-pages.mjs (the "/" redirector page).
 */

/** What a verification token may contain. Anything else could break out of the meta attribute. */
export const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{10,100}$/;

export const GOOGLE_VARIABLE = 'NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION';
export const BING_VARIABLE = 'NEXT_PUBLIC_BING_SITE_VERIFICATION';

/**
 * The trimmed token, or undefined when blank. THROWS on a malformed one, naming
 * the variable and the pattern, never the token value.
 * @param {string} variable
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function verificationToken(variable, value) {
  const token = value?.trim();
  if (!token) return undefined;
  if (!VERIFICATION_TOKEN.test(token)) {
    throw new Error(
      `${variable} is not a valid site-verification token: paste only the content value, not the whole meta tag (expected ${VERIFICATION_TOKEN.source}).`,
    );
  }
  return token;
}
