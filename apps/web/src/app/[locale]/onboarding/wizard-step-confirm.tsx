'use client';

import type { useTranslations } from 'next-intl';

// Step 3 of the onboarding wizard: the language/currency confirmation summary.
// Purely presentational — the active locale is passed in from the parent.
export function WizardStepConfirm({
  t,
  home,
  locale,
}: {
  t: ReturnType<typeof useTranslations<'onboarding'>>;
  home: ReturnType<typeof useTranslations<'home'>>;
  locale: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('step3Title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('confirmHint')}</p>
      </div>
      <dl className="divide-y rounded-xl border">
        <div className="flex items-center justify-between p-3">
          <dt className="text-sm text-muted-foreground">
            {t('confirmLanguage')}
          </dt>
          <dd className="text-sm font-medium">{home('localeName')}</dd>
        </div>
        <div className="flex items-center justify-between p-3">
          <dt className="text-sm text-muted-foreground">
            {t('confirmCurrency')}
          </dt>
          <dd className="text-sm font-medium">{t('currencyEgp')}</dd>
        </div>
      </dl>
      <input type="hidden" value={locale} readOnly />
    </div>
  );
}
