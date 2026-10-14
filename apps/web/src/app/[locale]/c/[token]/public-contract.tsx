'use client';

import { Check, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Centered, Row } from '@/components/share/link-page-parts';
import { LinkNameField } from '@/components/share/link-name-field';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import { formatMoney } from '@/lib/format/money';
import { formatPercent, formatQuantity } from '@/lib/format/number';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { PublicContract } from '@/lib/contracts/public';
import { contractDecidedKey } from './contract-outcome';
import { useContractAck } from './use-contract-ack';

export function PublicContractView({
  token,
  contract,
}: {
  token: string;
  contract: PublicContract | null;
}) {
  const t = useTranslations('contracts.ack');
  const locale = useLocale();
  const ack = useContractAck(token);

  if (!contract) {
    return <Centered>{t('invalid')}</Centered>;
  }

  const m = (v: string) => formatMoney(v, locale);
  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const num = formatDocNumber('C', contract.number, docYear(null, new Date()));

  const decided = contract.status !== 'issued' || ack.outcome !== null;
  const decidedMessage = t(contractDecidedKey(contract.status, ack.outcome));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-heading font-semibold">
          {pick(contract.org.name_ar, contract.org.name_en) || 'Metra'}
        </h1>
        <p className="text-body text-muted-foreground">
          {t('heading')} · <span dir="ltr">{num}</span>
        </p>
        <p className="font-medium">{pick(contract.title_ar, contract.title_en)}</p>
      </header>

      {contract.sections.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-body font-semibold">{pick(s.title_ar, s.title_en)}</h2>
              <span className="text-body" dir="ltr">{m(s.section_subtotal)}</span>
            </div>
            <table className="w-full text-body">
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{pick(l.description_ar, l.description_en)}</td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {formatQuantity(l.qty, locale)} {l.unit}
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
        <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-body">
          <Row label={t('originalValue')} value={m(contract.total)} bold />
          <Row label={t('advancePct')} value={formatPercent(contract.advance_pct, locale)} />
          <Row label={t('retentionPct')} value={formatPercent(contract.retention_pct, locale)} />
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
            <LinkNameField
              ref={ack.nameRef}
              id="c-name"
              label={t('nameLabel')}
              value={ack.name}
              onChange={ack.setName}
              error={ack.nameMissing ? t('nameRequired') : null}
            />
            <PortalFailureAlert failure={ack.failure} />
            <div className="flex justify-center">
              <Button variant="default" onClick={ack.acknowledge} disabled={ack.pending}>
                {ack.pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {t('button')}
              </Button>
            </div>
            <p className="text-center text-caption text-muted-foreground">
              {t('notSignature')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
