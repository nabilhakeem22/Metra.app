/**
 * Public base URL for SEO metadata (canonical, Open Graph, sitemap, robots host).
 *
 * Sourced ONLY from the public `NEXT_PUBLIC_APP_URL` env var — never a secret,
 * never the database URL. When the var is unset (local dev / CI), it falls back
 * to the known staging origin so metadata routes still emit absolute URLs
 * instead of a wrong or empty domain.
 */
const FALLBACK_SITE_URL = 'https://metra-app-web.vercel.app';

/** Absolute, trailing-slash-free base URL for public SEO surfaces. */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  return configured && configured.length > 0 ? configured : FALLBACK_SITE_URL;
}
