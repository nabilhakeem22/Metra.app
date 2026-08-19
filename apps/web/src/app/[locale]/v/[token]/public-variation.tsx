'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format/money';
import { formatDocNumber } from '@/lib/format/doc-number';
import type { PublicVariation } from '@/lib/variations/public';
import { respondToVariation } from './actions';

export function PublicVariationView({
  token,
  variation,
}: {
  token: string;
  variation: PublicVariation | null;
}) {
  const t = useTranslations('variations');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<
    'approved' | 'rejected' | 'already' | 'expired' | 'invalid' | null
  >(null);
  const [name, setName] = useState('');

  if (!variation) {
    return <Centered>{t('client.invalid')}</Centered>;
  }

  const m = (v: string) => formatMoney(v, locale);
  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const num = formatDocNumber('VO', variation.number, new Date().getFullYear());

  function respond(decision: 'approve' | 'reject') {
    startTransition(async () => {
      const res = await respondToVariation(token, decision, name);
      if (res.ok) setOutcome(decision === 'approve' ? 'approved' : 'rejected');
      else if (res.error === 'token_expired') setOutcome('expired');
      else if (res.error === 'already_responded') setOutcome('already');
      else setOutcome('invalid');
    });
  }

  const decided = variation.status !== 'issued' || outcome !== null;
  const decidedMessage =
    outcome === 'approved' || variation.status === 'approved'
      ? t('client.approved')
      : outcome === 'rejected' || variation.status === 'rejected'
        ? t('client.rejected')
        : outcome === 'expired'
          ? t('client.expired')
          : outcome === 'invalid'
            ? t('client.invalid')
            : t('client.already');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          {pick(variation.org.name_ar, variation.org.name_en) || 'Metra'}
        </h1>
        <p className="text-sm text-muted-foreground" dir="ltr">
          {t('variation')} · {num}
        </p>
        <p className="font-medium">{pick(variation.title_ar, variation.title_en)}</p>
        {(variation.reason_ar || variation.reason_en) && (
          <p className="text-sm text-muted-foreground">
            {pick(variation.reason_ar, variation.reason_en)}
          </p>
        )}
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
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
        <CardContent className="ms-auto max-w-xs py-4 text-sm" dir="ltr">
          <div className="flex justify-between font-semibold">
            <span className="text-muted-foreground">{t('netDelta')}</span>
            <span>{m(variation.net_delta)}</span>
          </div>
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
            <p className="text-sm text-muted-foreground">{t('client.intro')}</p>
            <Input
              placeholder={t('client.nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex justify-center gap-3">
              <Button onClick={() => respond('approve')} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {t('client.approve')}
              </Button>
              <Button variant="outline" onClick={() => respond('reject')} disabled={pending}>
                <X className="size-4" aria-hidden />
                {t('client.reject')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">
      {children}
    </div>
  );
}
