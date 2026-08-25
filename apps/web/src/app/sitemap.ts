import type { MetadataRoute } from 'next';
import { LOCALES } from '@/i18n/routing';
import { getSiteUrl } from '@/lib/seo/site-url';

// The only genuinely public URL is the landing/login page, once per locale.
// Every authed/onboarding/token URL is deliberately excluded. Each entry
// carries the en <-> ar-EG hreflang alternates App Router supports.
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getSiteUrl();
  const lastModified = new Date();

  const languages = Object.fromEntries(
    LOCALES.map((locale) => [locale, `${baseUrl}/${locale}`]),
  );

  return LOCALES.map((locale) => ({
    url: `${baseUrl}/${locale}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 1,
    alternates: { languages },
  }));
}
