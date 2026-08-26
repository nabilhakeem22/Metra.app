import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
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
      title: `${siteName} — ${title}`,
      description,
      siteName,
      locale: OG_LOCALE[locale as Locale] ?? OG_LOCALE.en,
      url: `/${locale}`,
    },
    twitter: {
      card: 'summary',
      title: `${siteName} — ${title}`,
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
  const tMeta = await getTranslations({ locale, namespace: 'landing.seo' });

  return (
    <>
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
