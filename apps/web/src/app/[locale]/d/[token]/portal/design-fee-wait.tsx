'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useMilestoneLabel } from './use-milestone-label';

/**
 * Why the design card says it is the client's move when no review is open: the
 * next step waits on this instalment. The act only opens the payments card on the
 * same page, where the amount and the way to pay are; it sends nothing. With no
 * payment details on the page (`canSayHowToPay` false) it promises no way to pay:
 * the client is sent to the designer, and the act only shows the instalment.
 */
export function DesignFeeWait({ kind, canSayHowToPay }: { kind: string; canSayHowToPay: boolean }) {
  const t = useTranslations('delivery');
  const milestoneLabel = useMilestoneLabel();
  return (
    <div className="space-y-3">
      <p data-fee-wait className="text-body font-medium">
        {t('hero.feeWait', { instalment: milestoneLabel(kind) })}
      </p>
      {!canSayHowToPay && <p className="text-body text-muted-foreground">{t('hero.feeWaitAskDesigner')}</p>}
      <Button asChild variant="default" size="lg" className="w-full">
        <a href="#payments">{t(canSayHowToPay ? 'home.act.howToPay' : 'home.act.seePayment')}</a>
      </Button>
    </div>
  );
}
