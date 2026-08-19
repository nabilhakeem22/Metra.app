'use client';

import { Check, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format/money';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { PublicContract } from '@/lib/contracts/public';
import { acknowledgeContract } from './actions';

export function PublicContractView({
  token,
  contract,
}: {
  token: string;
  contract: PublicContract | null;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<
    'signed' | 'already' | 'expired' | 'invalid' | null
  >(null);
  const [name, setName] = useState('');

  if (!contract) {
    return <Centered>{t('ack.invalid')}</Centered>;
  }

  const m = (v: string) => formatMoney(v, locale);
  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const num = formatDocNumber('C', contract.number, docYear(null, new Date()));

  function acknowledge() {
    startTransition(async () => {
      const res = await acknowledgeContract(token, name);
      if (res.ok) setOutcome('signed');
      else if (res.error === 'token_expired') setOutcome('expired');
      else if (res.error === 'already_responded') setOutcome('already');
      else setOutcome('invalid');
    });
  }

  const decided = contract.status !== 'issued' || outcome !== null;
  const decidedMessage =
    outcome === 'signed' || contract.status === 'signed'
      ? t('ack.done')
      : outcome === 'expired'
        ? t('ack.expired')
        : outcome === 'invalid'
          ? t('ack.invalid')
          : t('ack.already');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          {pick(contract.org.name_ar, contract.org.name_en) || 'Metra'}
        </h1>
        <p className="text-sm text-muted-foreground" dir="ltr">
          {t('contract')} · {num}
        </p>
        <p className="font-medium">{pick(contract.title_ar, contract.title_en)}</p>
      </header>

      {contract.sections.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">{pick(s.title_ar, s.title_en)}</h2>
              <span className="text-sm" dir="ltr">{m(s.section_subtotal)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {s.lines.map((l) => (
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
      ))}

      <Card>
        <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-sm" dir="ltr">
          <Row label={t('originalValue')} value={m(contract.total)} bold />
          <Row label={t('header.advancePct')} value={`${contract.advance_pct}%`} />
          <Row label={t('header.retentionPct')} value={`${contract.retention_pct}%`} />
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
            <p className="text-sm text-muted-foreground">{t('ack.intro')}</p>
            <Input
              placeholder={t('ack.nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex justify-center">
              <Button onClick={acknowledge} disabled={pending || !name.trim()}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {t('ack.button')}
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {t('ack.notSignature')}
            </p>
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
