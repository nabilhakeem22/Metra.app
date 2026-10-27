'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { StatusChip } from '@/components/ui/status-chip';
import { Link } from '@/i18n/routing';
import { contractChip } from '@/lib/client-home/contract-chip';
import { homeHref } from '@/lib/client-home/tab';
import type { HomeExecution } from '@/lib/client-home/types';
import { tokenPathSegment } from '@/lib/engagements/portal-path';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { ContractDocumentDisclosure } from './contract-document';
import { ContractIssuedStep, type ContractSigningFacts } from './contract-issued-step';
import { ContractSignNotice } from './contract-sign-notice';
import { DocumentNumber } from './document-number';
import { formatPortalMoney } from './portal-money';
import type { SignNotice } from './use-contract-signing';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t py-2 first:border-t-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-end text-body font-medium">{children}</dd>
    </div>
  );
}

/**
 * The Execution tab's CONTRACT: the execution contract's number and title,
 * where it stands, its value, when and how it was signed, when the works are
 * expected to finish, and when it ended if it did. Before the studio issues one,
 * it says so and, for a delivery that began with a design, links the design
 * record. An issued or signed contract opens in full on the client's tap
 * (./contract-document.tsx). While it waits for the client's signature, its
 * document is open with the page and the client signs it here, with a
 * one-time code (./contract-issued-step.tsx); what the signing came to is said
 * here and still stands after the page is read again, while the page still
 * shows that contract. فصحى copy, Latin digits.
 */
export function ExecutionContract({
  token,
  execution,
  firmName,
  showsDesignRecord,
  signing,
}: {
  token: string;
  execution: HomeExecution;
  firmName: string;
  /** The delivery began with a design, so its record is a tab of this page. */
  showsDesignRecord: boolean;
  signing: ContractSigningFacts;
}) {
  const t = useTranslations('delivery.contract');
  const locale = useLocale();
  // Kept with the contract it was said about: a page read again naming another contract never shows it (functional F1).
  const [said, setSaid] = useState<{ contractId: string; notice: SignNotice } | null>(null);
  const awaitingSignature = execution.location.reason === 'sign_contract';
  const day = (date: string) => bidiIsolate(formatDate(date, locale));
  const { contract, money } = execution;
  const signNotice = said !== null && said.contractId === contract?.id ? said.notice : null;
  const title = pickLocale(money?.contract, 'title', locale).value;
  const chip = contract && contractChip(contract);

  return (
    <section id="contract" aria-labelledby="home-contract-title" className="space-y-2 rounded-panel border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="home-contract-title" className="text-body font-semibold">
          {t('title')}
        </h2>
        {chip && <StatusChip tone={chip.tone} label={t(`status.${chip.key}`)} />}
      </div>
      {contract ? (
        <>
          <p className="text-body font-medium">
            <DocumentNumber>{contract.documentNumber}</DocumentNumber>
            {title && <span className="text-muted-foreground"> · {title}</span>}
          </p>
          <dl>
            {money && (
              <Fact label={t('value')}>
                <span dir="ltr" className="font-mono tabular-nums">
                  {formatPortalMoney(money.contract.originalValue, locale)}
                </span>
              </Fact>
            )}
            {contract.signed && (
              <Fact label={t('signedOn')}>
                {t(`signedVia.${contract.signed.via}`, { date: day(contract.signed.on), studio: firmName })}
              </Fact>
            )}
            {contract.revisedFinish && contract.status !== 'terminated' && <Fact label={t('expectedFinish')}>{day(contract.revisedFinish)}</Fact>}
            {contract.terminatedAt && <Fact label={t('terminatedOn')}>{day(contract.terminatedAt)}</Fact>}
          </dl>
          {/* Keyed by the contract: a page read again naming another one never keeps the old document under it. */}
          {contract.status !== 'terminated' && (
            <ContractDocumentDisclosure
              key={contract.id}
              token={token}
              contractId={contract.id}
              initial={awaitingSignature ? signing.document : null}
            />
          )}
          {contract.status === 'issued' && (
            <ContractIssuedStep
              token={token}
              contract={contract}
              awaitingSignature={awaitingSignature}
              signing={signing}
              noticeShown={signNotice !== null}
              onNotice={(notice) => setSaid(notice && { contractId: contract.id, notice })}
            />
          )}
          <ContractSignNotice notice={signNotice} studio={firmName} />
        </>
      ) : (
        <p className="text-body text-muted-foreground">{t('none', { studio: firmName })}</p>
      )}
      {execution.previousContractTerminatedAt && (
        <p className="text-caption text-muted-foreground">{t('previousTerminated', { date: day(execution.previousContractTerminatedAt) })}</p>
      )}
      {!contract && showsDesignRecord && (
        <Link href={homeHref(tokenPathSegment(token), 'design')} prefetch={false} className="inline-flex min-h-11 items-center text-body font-semibold text-primary underline-offset-4 hover:underline">
          {t('designRecord')}
        </Link>
      )}
    </section>
  );
}
