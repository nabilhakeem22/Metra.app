'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { LinkNameField } from '@/components/share/link-name-field';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UNCONFIRMED_WRITE, unansweredFailure, type ShownPortalFailure } from '@/lib/share/portal-failure';
import { variationOutcomeOf, type VariationOutcome } from '@/lib/variations/decided-message';
import { respondToVariation } from './actions';

/**
 * A proposal contract's change order still open to the client: the name box and
 * the two answers, on this page with no code (OD3 analog). A landed answer is
 * handed up as the outcome; one that never landed keeps the decision open.
 */
export function VariationDecisionCard({ token, onOutcome }: { token: string; onOutcome: (outcome: VariationOutcome) => void }) {
  const t = useTranslations('variations.client');
  const [pending, startTransition] = useTransition();
  // An answer that never landed: the decision stays open, the buttons stay.
  const [failure, setFailure] = useState<ShownPortalFailure | null>(null);
  const [name, setName] = useState('');

  function respond(decision: 'approve' | 'reject') {
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await respondToVariation(token, decision, name);
        const failed = unansweredFailure(res);
        if (failed) setFailure(failed);
        else onOutcome(variationOutcomeOf(res, decision));
      } catch {
        // The answer never came back: it may have been recorded (UNCONFIRMED_WRITE).
        setFailure(UNCONFIRMED_WRITE);
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-body text-muted-foreground">{t('intro')}</p>
        <LinkNameField id="v-name" label={t('nameLabel')} value={name} onChange={setName} />
        <PortalFailureAlert failure={failure} />
        <div className="flex justify-center gap-3">
          <Button variant="default" onClick={() => respond('approve')} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            {t('approve')}
          </Button>
          <Button variant="secondary" onClick={() => respond('reject')} disabled={pending}>
            <X className="size-4" aria-hidden />
            {t('reject')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
