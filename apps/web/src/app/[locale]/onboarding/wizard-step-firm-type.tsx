'use client';

import { Check } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { FIRM_TYPES, type FirmTypeKey } from '@/lib/entitlements/firm-types';

// The onboarding message keys for each firm-type card. Kept beside the registry
// so a new firm type surfaces a missing-key at build rather than silently.
const FIRM_TYPE_COPY: Record<FirmTypeKey, { label: string; desc: string }> = {
  interior: { label: 'firmTypeInterior', desc: 'firmTypeInteriorDesc' },
  construction: { label: 'firmTypeConstruction', desc: 'firmTypeConstructionDesc' },
  both: { label: 'firmTypeBoth', desc: 'firmTypeBothDesc' },
};

// Step 2 of the onboarding wizard: the firm-type radio group. Purely
// presentational — firmType selection state lives in the parent OnboardingWizard.
export function WizardStepFirmType({
  t,
  firmType,
  setFirmType,
}: {
  t: ReturnType<typeof useTranslations<'onboarding'>>;
  firmType: FirmTypeKey;
  setFirmType: (key: FirmTypeKey) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('step2Title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('firmTypeHint')}</p>
      </div>
      <div
        role="radiogroup"
        aria-label={t('step2Title')}
        className="space-y-2"
      >
        {FIRM_TYPES.map((def) => {
          const selected = firmType === def.key;
          const copy = FIRM_TYPE_COPY[def.key];
          return (
            <button
              key={def.key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={!def.available}
              disabled={!def.available}
              tabIndex={def.available ? 0 : -1}
              onClick={() => def.available && setFirmType(def.key)}
              className={`glass-field focus-ring-brand flex w-full items-start gap-3 p-4 text-start outline-none transition-colors motion-reduce:transition-none ${
                def.available
                  ? 'cursor-pointer hover:bg-[color:var(--track)]'
                  : 'cursor-not-allowed opacity-60'
              } ${
                selected
                  ? 'border-[color:hsl(var(--brand))] bg-brand-tint'
                  : ''
              }`}
            >
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  selected
                    ? 'border-[color:hsl(var(--brand))] bg-[color:hsl(var(--brand))] text-white'
                    : 'border-[color:var(--glass-hairline)]'
                }`}
                aria-hidden
              >
                {selected && <Check className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[color:var(--text)]">
                    {t(copy.label)}
                  </span>
                  {!def.available && (
                    <Badge variant="default">{t('firmTypeComingSoon')}</Badge>
                  )}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {t(copy.desc)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
