'use client';

import { Check, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ContractScheduleCard } from '@/components/client-contract/schedule-card';
import { ContractSectionList } from '@/components/client-contract/section-list';
import { ContractTotalsCard } from '@/components/client-contract/totals-card';
import { Centered } from '@/components/share/link-page-parts';
import { LinkNameField } from '@/components/share/link-name-field';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import { formatDate } from '@/lib/format/date';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { PublicContract } from '@/lib/contracts/public-types';
import { loadContractSectionLines, loadContractSections } from './actions';
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

  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const num = formatDocNumber('C', contract.number, docYear(null, new Date()));

  const decided = contract.status !== 'issued' || ack.outcome !== null;
  // The signing day is the Cairo day the snapshot carries (YYYY-MM-DD), never a UTC timestamp.
  const decidedMessage = t(contractDecidedKey(contract, ack.outcome), {
    date: contract.signed ? formatDate(contract.signed.on, locale) : '',
  });

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

      <ContractSectionList
        sections={contract.sections}
        sectionCount={contract.section_count}
        loadSections={(offset) => loadContractSections(token, offset)}
        loadSectionLines={(sectionId, offset) => loadContractSectionLines(token, sectionId, offset)}
      />

      <ContractTotalsCard contract={contract} />
      <ContractScheduleCard contract={contract} />

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
