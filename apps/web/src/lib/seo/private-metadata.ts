import type { Metadata } from 'next';

/**
 * Shared metadata for private surfaces — the authed `(app)` shell, onboarding,
 * the `(auth)` OTP steps, and the tokenized public share links. These must
 * never be indexed: they are either auth-gated or single-use share URLs.
 */
export const PRIVATE_METADATA: Metadata = {
  robots: { index: false, follow: false },
};
