'use client';

import { useTranslations } from 'next-intl';

/**
 * The firm-branded header: an initial mark + the firm name + a calm subtitle.
 * Logical CSS only; the initial mark is decorative (aria-hidden). The firm name
 * is already locale-picked by the parent.
 */
export function FirmHeader({ firmName }: { firmName: string }) {
  const t = useTranslations('delivery');
  const initial = firmName.trim().charAt(0) || 'M';
  return (
    <header className="flex items-center gap-3 rounded-2xl border bg-background p-4 shadow-sm">
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary"
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold leading-tight">{firmName}</p>
        <p className="truncate text-xs text-muted-foreground">{t('firmSubtitle')}</p>
      </div>
    </header>
  );
}
