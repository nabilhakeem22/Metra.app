'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/routing';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { formatMoney } from '@/lib/format/money';
import { issueContract, terminateContract } from '@/lib/contracts/actions';
import type { ContractPageDetail, ContractSectionsPage } from '@/lib/contracts/queries';
import type { ContractScheduleView } from '@/lib/contracts/schedule/queries';
import type { VariationListRow } from '@/lib/variations/queries';
import { ContractOverview } from './contract-overview';
import { ContractTabStrip } from './contract-tab-strip';
import type { ContractAction } from './contract-vo-types';
import { CostsTab } from './costs-tab';
import { ScheduleTab } from './schedule-tab';
import type { ContractTab } from './tabs';
import { useKeptSectionLines } from './use-kept-section-lines';
import { useKeptSections } from './use-kept-sections';
import { VariationRegister } from './variation-register';

export function ContractDetailClient({
  detail,
  openingSections,
  variations,
  schedule,
  tabs,
  openingTab,
  canSignOffline,
  canCreateCosts,
  canPickCostItem,
  canManage,
  canIssue,
  canDraftVariation,
  canPriceVariation,
}: {
  detail: ContractPageDetail;
  /** The first page of sections when the page opened on the overview; null on another tab. */
  openingSections: ContractSectionsPage | null;
  variations: VariationListRow[];
  /** The payment schedule of an execution contract; null on a proposal contract. */
  schedule: ContractScheduleView | null;
  /** Schedule and Costs are among them only on an execution contract; Costs only for a role that reads its costs. */
  tabs: readonly ContractTab[];
  openingTab: ContractTab;
  /** Owner, admin or project manager: may record a paper signature (D5). */
  canSignOffline: boolean;
  canCreateCosts: boolean;
  /** The price book search, for the cost entry form's item. */
  canPickCostItem: boolean;
  canManage: boolean;
  canIssue: boolean;
  canDraftVariation: boolean;
  canPriceVariation: boolean;
}) {
  const t = useTranslations('contracts');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<ContractTab>(openingTab);
  const keptSections = useKeptSections(openingSections);
  const keptLines = useKeptSectionLines();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const m = (v: string) => formatMoney(v, locale);

  const act: ContractAction = (fn) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          if (res.link) setLink(res.link);
          router.refresh();
        } else {
          setError(describeFailure(res, te));
        }
      } catch (rejection) {
        setError(describeRejection(rejection, te));
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
      )}
      {link && (
        <Card>
          <CardContent className="flex items-center gap-2 py-3 text-body">
            <span className="text-muted-foreground">{t('shareLink')}:</span>
            <code className="flex-1 truncate" dir="ltr">
              {link}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(link)}
            >
              {t('copyLink')}
            </Button>
          </CardContent>
        </Card>
      )}

      <ContractTabStrip tabs={tabs} current={tab} onSelect={setTab} />

      {tab === 'overview' && (
        <ContractOverview
          detail={detail}
          keptSections={keptSections}
          keptLines={keptLines}
          canManage={canManage}
          canIssue={canIssue}
          canSignOffline={canSignOffline}
          pending={pending}
          m={m}
          onIssue={() => act(() => issueContract(detail.id))}
          onTerminate={() => act(() => terminateContract(detail.id))}
        />
      )}
      {tab === 'schedule' && schedule && (
        <ScheduleTab
          contractId={detail.id}
          status={detail.status}
          canManage={canManage}
          schedule={schedule}
          contract={detail}
          m={m}
        />
      )}
      {tab === 'costs' && (
        <CostsTab
          contractId={detail.id}
          contractStatus={detail.status}
          canCreate={canCreateCosts}
          canPickCostItem={canPickCostItem}
          m={m}
        />
      )}
      {tab === 'variations' && (
        <VariationRegister
          contractId={detail.id}
          contractStatus={detail.status}
          chargeRates={
            detail.sourceBoqId === null
              ? null
              : { taxRate: detail.taxRate, supervisionPct: detail.supervisionPct }
          }
          variations={variations}
          canDraftVariation={canDraftVariation}
          canPriceVariation={canPriceVariation}
          pending={pending}
          m={m}
          act={act}
        />
      )}
    </div>
  );
}
