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
import { isLocale, LOCALES, type Locale } from '@/i18n/routing';
import { buildLandingMetadata } from '@/lib/seo/landing-metadata';
import './landing.css';

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
  // Not a locale (/wp-login.php matches this route with locale = "wp-login.php"):
  // the layout answers 404, so the page must not add an indexable canonical to it.
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'landing.seo' });
  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  return buildLandingMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    siteName: tMeta('siteName'),
    ogImageAlt: t('ogImageAlt'),
  });
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
