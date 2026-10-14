'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Centered, Row } from '@/components/share/link-page-parts';
import { LinkNameField } from '@/components/share/link-name-field';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import { formatMoney } from '@/lib/format/money';
import { formatDocNumber } from '@/lib/format/doc-number';
import { unansweredFailure, type ShownPortalFailure } from '@/lib/share/portal-failure';
import {
  variationDecidedKey,
  variationIsDecided,
  variationOutcomeOf,
  type VariationOutcome,
} from '@/lib/variations/decided-message';
import type { PublicVariation } from '@/lib/variations/public';
import { respondToVariation } from './actions';

export function PublicVariationView({
  token,
  variation,
}: {
  token: string;
  variation: PublicVariation | null;
}) {
  const t = useTranslations('variations.client');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<VariationOutcome>(null);
  // An answer that never landed: the decision stays open, the buttons stay.
  const [failure, setFailure] = useState<ShownPortalFailure | null>(null);
  const [name, setName] = useState('');

  if (!variation) {
    return <Centered>{t('invalid')}</Centered>;
  }

  const m = (v: string) => formatMoney(v, locale);
  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const num = formatDocNumber('VO', variation.number, new Date().getFullYear());

  function respond(decision: 'approve' | 'reject') {
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await respondToVariation(token, decision, name);
        const failed = unansweredFailure(res);
        if (failed) setFailure(failed);
        else setOutcome(variationOutcomeOf(res, decision));
      } catch (rejection) {
        setFailure({ rejection });
      }
    });
  }

  // The ladder's ORDER is a product decision: lib/variations/decided-message.ts.
  const decisionState = {
    status: variation.status,
    contractActive: variation.contractActive,
    outcome,
    rejectionChannel: variation.rejectionChannel,
  };
  const decided = variationIsDecided(decisionState);
  const decidedMessage = t(variationDecidedKey(decisionState));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-heading font-semibold">
          {pick(variation.org.name_ar, variation.org.name_en) || 'Metra'}
        </h1>
        <p className="text-body text-muted-foreground">
          {t('heading')} · <span dir="ltr">{num}</span>
        </p>
        <p className="font-medium">{pick(variation.title_ar, variation.title_en)}</p>
        {(variation.reason_ar || variation.reason_en) && (
          <p className="text-body text-muted-foreground">
            {pick(variation.reason_ar, variation.reason_en)}
          </p>
        )}
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-body">
            <tbody>
              {variation.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{pick(l.description_ar, l.description_en)}</td>
                  <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                    {l.qty} {l.unit}
                  </td>
                  <td className="px-4 py-2 text-end" dir="ltr">{m(l.unit_price)}</td>
                  <td className="px-4 py-2 text-end" dir="ltr">{m(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="ms-auto max-w-xs py-4 text-body">
          <Row label={t('netDelta')} value={m(variation.net_delta)} bold />
        </CardContent>
      </Card>

      {decided ? (
        <Card>
          <CardContent className="py-6 text-center font-medium">
            {decidedMessage}
          </CardContent>
        </Card>
      ) : (
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
      )}
    </div>
  );
}
