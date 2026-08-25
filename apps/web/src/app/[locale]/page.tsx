import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { LOCALES, Link, type Locale } from '@/i18n/routing';

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
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('title');
  const description = t('description');
  const siteName = t('siteName');

  // hreflang: one entry per locale, resolved against metadataBase.
  const languages = Object.fromEntries(
    LOCALES.map((code) => [code, `/${code}`]),
  );

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

export default function HomePage() {
  const t = useTranslations('home');

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-8 py-16 text-center">
      <div className="space-y-3">
        <h1 className="text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-xl text-muted-foreground">{t('tagline')}</p>
      </div>
      <p className="max-w-xl text-balance text-muted-foreground">{t('intro')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/onboarding">{t('getStarted')}</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/login">{t('signIn')}</Link>
        </Button>
      </div>
    </main>
  );
}
