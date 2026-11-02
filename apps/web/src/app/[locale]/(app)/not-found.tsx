import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';

/**
 * Every notFound() thrown by a page under (app): a stale project link, a record
 * of another firm. It renders INSIDE this segment's layout, so the studio keeps
 * its sidebar, top bar and sign-out, and the way out is the dashboard, not the
 * marketing landing (../not-found.tsx stays the 404 for public paths). Studio
 * copy, in Egyptian Arabic. Next adds the noindex meta, the middleware the
 * X-Robots-Tag header.
 */
export default async function AppNotFound() {
  const t = await getTranslations('shell.notFound');
  return (
    <div className="space-y-3 py-10">
      <h1 className="text-heading font-bold">{t('title')}</h1>
      <p className="text-body text-muted-foreground">{t('body')}</p>
      <Button variant="default" asChild>
        <Link href="/dashboard">{t('cta')}</Link>
      </Button>
    </div>
  );
}
