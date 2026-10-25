import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

/**
 * The way back into the site app from a studio page it opened (costs and
 * measurements, which the app opens with `?from=site`; plan C6). An installed
 * iOS web app has no back button, so the page offers one. Nothing at all when
 * the page was not opened from the app.
 *
 * A plain link, not a client route change: the app is its own static shell
 * under its own service worker, so the browser loads it whole.
 */
export async function BackToSiteAppLink({ from }: { from: string | string[] | undefined }) {
  if (from !== 'site') return null;
  const t = await getTranslations('site');
  const locale = await getLocale();
  return (
    <a
      href={`/${locale}/site`}
      className="inline-flex items-center gap-1 text-body text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3 rtl:-scale-x-100" aria-hidden />
      {t('backToApp')}
    </a>
  );
}
