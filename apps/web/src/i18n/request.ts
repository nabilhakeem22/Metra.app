import { getRequestConfig } from 'next-intl/server';
import { LOCALES, routing, type Locale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = LOCALES.includes(requested as Locale)
    ? (requested as Locale)
    : routing.defaultLocale;

  return {
    locale,
    // Egypt-based studios; a global default timeZone prevents next-intl's
    // ENVIRONMENT_FALLBACK error and server/client hydration mismatches when any
    // surface formats a date/time.
    timeZone: 'Africa/Cairo',
    messages: (await import(`../messages/${locale}.json`)).default,

    /**
     * A missing message must be LOUD in development.
     *
     * `i18n:validate` compares en against ar, so it catches a key present in one
     * and absent from the other — but a key referenced in code and absent from
     * BOTH is invisible to it. That is not hypothetical: `engagements.command`
     * shipped `crumb`, `startedOn` and `feeChip` to production, where next-intl
     * fell back to printing the key path and a studio owner read
     * "ENGAGEMENTS.COMMAND.CRUMB" on his delivery page.
     *
     * A static scan of `t('literal')` calls was the obvious alternative and is
     * unreliable: two components in one file both name their translator `t` on
     * different namespaces, so it reports false positives. Throwing here is
     * exact — it fires on the real lookup, with the real namespace, the moment
     * the page renders.
     *
     * Development only. In production a missing key must never take a page down;
     * it is logged and falls back to the key path, as before.
     */
    onError(error) {
      if (
        process.env.NODE_ENV === 'development' &&
        error.code === 'MISSING_MESSAGE'
      ) {
        throw error;
      }
      console.error(error);
    },
  };
});
