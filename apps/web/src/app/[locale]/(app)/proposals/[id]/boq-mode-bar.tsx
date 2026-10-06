'use client';

import { ArrowLeft, Info, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * The top of the builder in BOQ mode: the way back to the delivery, and the one
 * sentence that explains what this document is. Back is `use-boq-back.ts`; this
 * renders it, disabled whenever the builder is busy (a send in flight included).
 */
export function BoqModeBar({
  onBack,
  pending,
  disabled,
}: {
  onBack: () => void;
  /** THIS control's save is in flight. */
  pending: boolean;
  /** Anything in the builder is in flight. */
  disabled: boolean;
}) {
  const t = useTranslations('proposals.boqMode');
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack} disabled={disabled}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        )}
        {t('back')}
      </Button>
      <div className="flex items-start gap-2.5 rounded-panel border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] px-4 py-3 text-small text-[color:var(--text)]">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
        <p>{t('banner')}</p>
      </div>
    </div>
  );
}
