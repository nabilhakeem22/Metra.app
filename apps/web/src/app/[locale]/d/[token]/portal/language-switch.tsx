'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { homeHref, type HomeTab } from '@/lib/client-home/tab';
import { tokenPathSegment } from '@/lib/engagements/portal-path';

/** The language a client page switches to, and that language's `lang` tag. */
const OTHER_LOCALE = {
  'ar-EG': { locale: 'en', lang: 'en' },
  en: { locale: 'ar-EG', lang: 'ar' },
} as const;

/**
 * The client page's language switch: a plain link to the SAME delivery in the
 * other language, labelled in that language («العربية» on the English page,
 * "English" on the Arabic one). It carries the tab the client is on and no
 * other query, so a stale `?document=unavailable` never follows the client
 * across, and it is a full navigation, so no answer held in the old language
 * survives the switch. Not prefetched: each view reads its tab once. 44 x 44 px
 * at least.
 */
export function LanguageSwitch({ token, locale, tab }: { token: string; locale: string; tab: HomeTab | null }) {
  const t = useTranslations('delivery.language');
  const target = OTHER_LOCALE[locale === 'en' ? 'en' : 'ar-EG'];
  return (
    <Link
      href={homeHref(tokenPathSegment(token), tab)}
      locale={target.locale}
      hrefLang={target.lang}
      lang={target.lang}
      prefetch={false}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-pill border bg-background px-3 text-body font-semibold outline-none focus-ring-brand hover:bg-muted"
    >
      {t('switchTo')}
    </Link>
  );
}
