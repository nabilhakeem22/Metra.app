'use client';

import { Check } from 'lucide-react';
import type { useTranslations } from 'next-intl';

// Step 4 of the onboarding wizard: the (coming-soon) team-invite step. Purely
// presentational — no state, just copy.
export function WizardStepInvite({
  t,
}: {
  t: ReturnType<typeof useTranslations<'onboarding'>>;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('step4Title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('inviteHint')}</p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-dashed p-4">
        <Check className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          {t('inviteComingSoon')}
        </p>
      </div>
    </div>
  );
}
