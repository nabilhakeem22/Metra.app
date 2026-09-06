// The Metra palette for EMAIL, as literal hex.
//
// Email is the one surface that cannot read the app's design tokens: mail
// clients strip <style> blocks and have no CSS custom properties, so every
// colour has to be inlined at the point of use. These constants exist so the
// identity still lives in ONE place rather than being retyped in each template
// — when the brand moves, this file moves with it and the templates follow.
//
// Values are the Clear Light palette. Email is always rendered light: dark-mode
// mail clients apply their own inversion and honour nothing we would send.

export const EMAIL_BRAND = {
  /** Page ground behind the card. */
  page: '#EBEFF5',
  /** The card itself. */
  card: '#FFFFFF',
  /** Headings. */
  text: '#111418',
  /** Body copy. */
  body: '#333A44',
  /** Secondary / fallback lines. */
  muted: '#5C6470',
  /** Primary action. Flat, not a gradient — Outlook drops gradients. */
  brand: '#2E6BE6',
  /** Label on the primary action. */
  onBrand: '#FFFFFF',
} as const;

/**
 * The wordmark as text, by direction. Email cannot rely on SVG — Gmail strips
 * it outright — so the lockup degrades to its name, in the right script. An
 * otherwise-Arabic message headed "Metra" reads as a different product.
 */
export function emailWordmark(dir: 'rtl' | 'ltr'): string {
  return dir === 'rtl' ? 'ميترا' : 'Metra';
}
