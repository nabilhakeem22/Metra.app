import type { Metadata } from 'next';
import { LOCALES, type Locale } from '@/i18n/routing';
import { landingLanguageAlternates, landingPath } from './indexable-pages';
import { siteVerification } from './site-verification';

// The landing page's metadata, from already-translated strings. PURE. Relative
// URLs resolve against the layout's metadataBase (NEXT_PUBLIC_APP_URL), so the
// rendered canonical, hreflang and og:image are absolute.

export interface LandingMetadataInput {
  locale: Locale;
  /** landing.seo.title (brand included; rendered as title.absolute). */
  title: string;
  /** landing.seo.description */
  description: string;
  /** meta.siteName */
  siteName: string;
  /** landing.seo.ogImageAlt */
  ogImageAlt: string;
}

/** Open Graph uses BCP-47-with-underscore locale codes. */
const OG_LOCALE: Record<Locale, string> = { 'ar-EG': 'ar_EG', en: 'en_US' };

/** The static 1200x630 share card of a locale (public/og). */
function ogImagePath(locale: Locale): string {
  return `/og/og.${locale}.png`;
}

export function buildLandingMetadata({ locale, title, description, siteName, ogImageAlt }: LandingMetadataInput): Metadata {
  const url = landingPath(locale);
  const image = ogImagePath(locale);
  const verification = siteVerification();
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url, languages: landingLanguageAlternates() },
    robots: { index: true, follow: true, googleBot: { 'max-image-preview': 'large' } },
    openGraph: {
      type: 'website',
      siteName,
      title,
      description,
      url,
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((other) => other !== locale).map((other) => OG_LOCALE[other]),
      images: [{ url: image, width: 1200, height: 630, alt: ogImageAlt }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
    ...(verification ? { verification } : {}),
  };
}
