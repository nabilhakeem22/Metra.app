'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { recordDeliveryAction } from '../actions';

/**
 * The budget-acknowledgement card. Deliberately SUBORDINATE — it renders below the
 * hero and never competes with it (deriveHero keeps `acknowledge_rom` out of the
 * hero, exposing it only via `showRomAck`). Fires the same append-only advisory
 * `recordDeliveryAction`; a repeat resolves ok (idempotent).
 */
export function RomAckCard({ token }: { token: string }) {
  const t = useTranslations('delivery.actions');
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordDeliveryAction(token, 'acknowledge_rom');
        if (result.ok) setConfirmed(true);
        else setError(result.error ?? 'generic');
      } catch {
        setError('generic');
      }
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-muted/30 p-4">
      <h2 className="text-sm font-semibold">{t('romTitle')}</h2>
      {confirmed ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
          {t('confirmedAcknowledged')}
        </p>
      ) : (
        <>
          <Button variant="outline" disabled={pending} onClick={submit}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('acknowledgeRom')}
          </Button>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {t(`error.${error}`)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
