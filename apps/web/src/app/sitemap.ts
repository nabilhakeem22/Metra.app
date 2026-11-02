import type { MetadataRoute } from 'next';
import { LOCALES } from '@/i18n/routing';
import { LANDING_LAST_MODIFIED, landingLanguageAlternates, landingPath } from '@/lib/seo/indexable-pages';
import { getSiteUrl } from '@/lib/seo/site-url';

// The only indexable URLs: the landing page, once per locale, each with the
// absolute hreflang alternates (x-default included). Pre-rendered and served as
// a static asset (emit-static-pages). `lastModified` is the landing-copy date,
// never the build clock: a date that moves on every deploy teaches Google to
// ignore it.
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const languages = Object.fromEntries(
    Object.entries(landingLanguageAlternates()).map(([hreflang, path]) => [hreflang, `${siteUrl}${path}`]),
  );
  return LOCALES.map((locale) => ({
    url: `${siteUrl}${landingPath(locale)}`,
    lastModified: LANDING_LAST_MODIFIED,
    changeFrequency: 'monthly',
    priority: 1,
    alternates: { languages },
  }));
}
