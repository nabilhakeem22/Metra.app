// The one shape check for a typed email address, and the form it is compared
// in. Pure and client-safe: the sign-in pre-check and the invite core share it.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Something@something.something, with no spaces. Loose on purpose: the mail
 *  provider is the real judge, this only catches a typo before it is sent. */
export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}
