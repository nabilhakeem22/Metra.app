import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleCookieSync } from '@/components/i18n/locale-cookie-sync';
import { FeatureCards } from '@/components/landing/feature-cards';
import { FinalCta } from '@/components/landing/final-cta';
import { HowItWorks } from '@/components/landing/how-it-works';
import { LandingFooter } from '@/components/landing/landing-footer';
import { LandingHero } from '@/components/landing/landing-hero';
import { LandingNav } from '@/components/landing/landing-nav';
import { Pricing } from '@/components/landing/pricing';
import { ProblemValue } from '@/components/landing/problem-value';
import { StructuredData } from '@/components/landing/structured-data';
import { TrustBand } from '@/components/landing/trust-band';
import { LOCALES, type Locale } from '@/i18n/routing';
import './landing.css';

// Open Graph uses BCP-47-with-underscore locale codes.
const OG_LOCALE: Record<Locale, string> = {
  'ar-EG': 'ar_EG',
  en: 'en_US',
};

// Pre-rendered at build time, one page per locale, and served as a static
// asset before the Worker runs (Workers Free plan CPU relief; the build's
// scripts/emit-static-pages.mjs copies the HTML). `dynamic = 'error'` fails the
// build if anything here reaches a request-time API, and no server action may
// be reachable from it: a POST to an asset path is a 405.
export const dynamic = 'error';

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.seo' });
  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  const title = t('title');
  const description = t('description');
  const siteName = tMeta('siteName');

  // hreflang: one entry per locale, resolved against metadataBase.
  const languages = Object.fromEntries(
    LOCALES.map((code) => [code, `/${code}`]),
  );

  // The landing is the one public, indexable surface — no `noindex` here.
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}`,
      languages,
    },
    openGraph: {
      type: 'website',
      // `·` not an em dash — this string renders in ar-EG (style-guide rule 6).
      title: `${siteName} · ${title}`,
      description,
      siteName,
      locale: OG_LOCALE[locale as Locale] ?? OG_LOCALE.en,
      url: `/${locale}`,
    },
    twitter: {
      card: 'summary',
      // `·` not an em dash — this string renders in ar-EG (style-guide rule 6).
      title: `${siteName} · ${title}`,
      description,
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tMeta = await getTranslations({ locale, namespace: 'landing.seo' });

  return (
    <>
      <LocaleCookieSync locale={locale as Locale} />
      <StructuredData locale={locale} description={tMeta('description')} />
      <div className="landing">
        <LandingNav />
        <main>
          <LandingHero />
          <TrustBand />
          <ProblemValue />
          <FeatureCards />
          <HowItWorks />
          <Pricing />
          <FinalCta />
        </main>
        <LandingFooter />
      </div>
    </>
  );
}
