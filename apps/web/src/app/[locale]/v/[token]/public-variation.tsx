'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Centered } from '@/components/share/link-page-parts';
import { formatMoney } from '@/lib/format/money';
import { formatDocNumber } from '@/lib/format/doc-number';
import {
  variationDecidedKey,
  variationIsDecided,
  type VariationOutcome,
} from '@/lib/variations/decided-message';
import { decidesInClientHome, isOpenForDecision } from '@/lib/variations/home-deciding';
import type { PublicVariation } from '@/lib/variations/public-types';
import { VariationChargeCard } from './variation-charge-card';
import { VariationDecisionCard } from './variation-decision-card';

export function PublicVariationView({
  token,
  variation,
}: {
  token: string;
  variation: PublicVariation | null;
}) {
  const t = useTranslations('variations.client');
  const locale = useLocale();
  const [outcome, setOutcome] = useState<VariationOutcome>(null);

  if (!variation) {
    return <Centered>{t('invalid')}</Centered>;
  }

  const m = (v: string) => formatMoney(v, locale);
  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const num = formatDocNumber('VO', variation.number, new Date().getFullYear());
  const studio = pick(variation.org.name_ar, variation.org.name_en) || 'Metra';

  // The ladder's ORDER is a product decision: lib/variations/decided-message.ts.
  const decisionState = {
    status: variation.status,
    contractActive: variation.contractActive,
    outcome,
    rejectionChannel: variation.rejectionChannel,
  };
  const decided = variationIsDecided(decisionState);
  const decidedKey = variationDecidedKey(decisionState);
  const decidedMessage = t(decidedKey);
  // The order as the page now stands (F2): open, approved (by the client's
  // click too), or closed any other way, which says no days at all.
  const standing = decided ? (decidedKey === 'approved' ? 'approved' : null) : variation.status;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-heading font-semibold">{studio}</h1>
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

      <VariationChargeCard variation={variation} standing={standing} m={m} />

      {decided ? (
        <Card>
          <CardContent className="py-6 text-center font-medium">
            {decidedMessage}
          </CardContent>
        </Card>
      ) : decidesInClientHome(variation) ? (
        // A lapsed order can no longer be decided anywhere online, so it is not sent to the home.
        <Card data-decide-in-home>
          <CardContent className="py-6 text-center font-medium">
            {isOpenForDecision(variation, Date.now()) ? t('decideInHome', { studio }) : t('expired')}
          </CardContent>
        </Card>
      ) : (
        <VariationDecisionCard token={token} onOutcome={setOutcome} />
      )}
    </div>
  );
}
