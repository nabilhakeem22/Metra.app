/**
 * Public base URL for SEO metadata (canonical, Open Graph, sitemap, robots).
 *
 * Sourced ONLY from the public `NEXT_PUBLIC_APP_URL` env var: never a secret,
 * never the database URL. A custom domain is therefore a variable change only.
 * The fallback serves local dev and unit tests alone: a production build cannot
 * reach it, because next.config.mjs throws when the variable is unset.
 */
const FALLBACK_SITE_URL = 'http://localhost:3000';

/** Absolute, trailing-slash-free base URL for public SEO surfaces. */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  return configured && configured.length > 0 ? configured : FALLBACK_SITE_URL;
}
