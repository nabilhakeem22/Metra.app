'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

/** The language a client page switches to, and that language's `lang` tag. */
const OTHER_LOCALE = {
  'ar-EG': { locale: 'en', lang: 'en' },
  en: { locale: 'ar-EG', lang: 'ar' },
} as const;

/**
 * The client page's language switch: a plain link to the SAME delivery in the
 * other language, labelled in that language («العربية» on the English page,
 * "English" on the Arabic one). It carries no query string, so a stale
 * `?document=unavailable` never follows the client across, and it is a full
 * navigation, so no answer held in the old language survives the switch. Not
 * prefetched: each view reads the delivery once. 44 x 44 px at least.
 */
export function LanguageSwitch({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations('delivery.language');
  const target = OTHER_LOCALE[locale === 'en' ? 'en' : 'ar-EG'];
  return (
    <Link
      href={`/d/${encodeURIComponent(token)}`}
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
