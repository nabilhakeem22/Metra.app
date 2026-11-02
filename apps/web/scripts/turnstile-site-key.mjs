/**
 * The one rule for the sign-in Turnstile SITE key. Plain .mjs so both readers
 * can import it: next.config.mjs (fails the build with a message Next prints
 * in full) and the login form's captcha hook (the key it renders with).
 */

export const TURNSTILE_SITE_KEY_VARIABLE = 'NEXT_PUBLIC_TURNSTILE_SITE_KEY';

/** Site keys are a digit, 'x', then 22 characters; secret keys are longer (33), so a pasted secret fails. */
export const TURNSTILE_SITE_KEY_SHAPE = /^[0-9]x[A-Za-z0-9_-]{20,30}$/;

/**
 * The trimmed key, or undefined when blank. THROWS on a malformed one, naming
 * the variable and the pattern, never the value.
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function turnstileSiteKey(value) {
  const key = value?.trim();
  if (!key) return undefined;
  if (!TURNSTILE_SITE_KEY_SHAPE.test(key)) {
    throw new Error(
      `${TURNSTILE_SITE_KEY_VARIABLE} is not a Turnstile site key: paste the SITE key, never the secret key (expected ${TURNSTILE_SITE_KEY_SHAPE.source}).`,
    );
  }
  return key;
}
