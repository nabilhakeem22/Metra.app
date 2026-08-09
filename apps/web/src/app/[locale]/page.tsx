import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';

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
