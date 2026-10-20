'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { SignOfflineDialog } from '@/components/contracts/sign-offline-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ContractPageDetail } from '@/lib/contracts/queries';
import { formatDate } from '@/lib/format/date';
import { ChargesForm } from './charges-form';
import { ContractFinishDate } from './contract-finish-date';
import { ContractHeaderForm } from './contract-header-form';
import { ContractSectionList } from './contract-section-list';
import type { KeptSectionLines } from './use-kept-section-lines';
import type { KeptSections } from './use-kept-sections';

export function ContractOverview({
  detail,
  keptSections,
  keptLines,
  canManage,
  canIssue,
  canSignOffline,
  pending,
  m,
  onIssue,
  onTerminate,
}: {
  detail: ContractPageDetail;
  keptSections: KeptSections;
  keptLines: KeptSectionLines;
  canManage: boolean;
  canIssue: boolean;
  canSignOffline: boolean;
  pending: boolean;
  m: (v: string) => string;
  onIssue: () => void;
  onTerminate: () => void;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const revised = detail.revisedValue !== detail.originalValue;
  const execution = detail.sourceBoqId !== null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-body">
          <span className={`rounded-pill px-2 py-0.5 text-caption`}>
            {t(`status.${detail.status}`)}
          </span>
          <span className="text-muted-foreground">
            {t('originalValue')}: <span dir="ltr">{m(detail.originalValue)}</span>
          </span>
          {revised && (
            <span className="text-muted-foreground">
              {t('revisedValue')}: <span dir="ltr">{m(detail.revisedValue)}</span>
            </span>
          )}
          {detail.signed && (
            <span className="text-muted-foreground">
              {t('signedOn', { date: formatDate(detail.signed.on, locale), via: detail.signed.via })}
            </span>
          )}
          {execution && (
            <ContractFinishDate endDate={detail.endDate} approvedExtensionDays={detail.approvedExtensionDays} />
          )}
          <div className="ms-auto flex gap-2">
            {execution && canSignOffline && detail.status === 'issued' && (
              <SignOfflineDialog contractId={detail.id} />
            )}
            {canIssue && detail.status === 'draft' && (
              <Button variant="default" size="sm" disabled={pending} onClick={onIssue}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('issue')}
              </Button>
            )}
            {canIssue &&
              (detail.status === 'issued' || detail.status === 'signed') && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={onTerminate}
                >
                  {t('terminate')}
                </Button>
              )}
          </div>
        </CardContent>
      </Card>

      {canManage && detail.status === 'draft' && execution && <ChargesForm detail={detail} m={m} />}

      {canManage && detail.status === 'draft' && (
        <ContractHeaderForm detail={detail} />
      )}

      <ContractSectionList contractId={detail.id} sections={keptSections} lines={keptLines} m={m} />
    </div>
  );
}
