'use client';

import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { PublicDelivery } from '@/lib/engagements/public';
import { portalErrorKey, type PortalErrorKey } from '@/lib/engagements/portal-error-key';
import { recordDeliveryAction } from '../actions';
import { BudgetRange } from './budget-range';

/**
 * The budget-acknowledgement card: the issued range first, then the button. It is
 * deliberately SUBORDINATE to the hero (deriveHero keeps `acknowledge_rom` out of
 * the hero, exposing it only via `showRomAck`). Fires the same append-only advisory
 * `recordDeliveryAction`; a repeat resolves ok (idempotent). `rom` is null until
 * the studio ISSUES the band, in which case the card asks without a figure, as it
 * always has. Theme tokens only, so the confirmed state reads in light and dark.
 */
export function BudgetCard({ token, rom }: { token: string; rom: PublicDelivery['rom'] }) {
  const t = useTranslations('delivery.budget');
  const tActions = useTranslations('delivery.actions');
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<PortalErrorKey | null>(null);

  function acknowledge() {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const result = await recordDeliveryAction(token, 'acknowledge_rom');
        if (result.ok) setConfirmed(true);
        else setError(portalErrorKey(result.error));
      } catch {
        setError('generic');
      }
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('preparedBy')}</p>
      </div>
      <BudgetRange rom={rom} />
      {confirmed ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl bg-[color:var(--success-tint)] px-3 py-2.5 text-sm font-semibold text-[color:var(--success)]"
        >
          <Check className="size-4 shrink-0" aria-hidden />
          {t('acknowledged')}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('note')}</p>
          <Button className="w-full" disabled={pending} onClick={acknowledge}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('acknowledge')}
          </Button>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {tActions(`error.${error}`)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
